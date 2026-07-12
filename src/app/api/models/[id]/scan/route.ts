import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUserId, getOrgId } from "@/lib/demo-helpers";
import { scanModelFile, readFileFromStorage } from "@/lib/scanner";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);

    const model = await db.model.findUnique({
      where: { id, deletedAt: null },
      include: {
        versions: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });

    if (!model || model.versions.length === 0) {
      return NextResponse.json({ error: "Model or version not found" }, { status: 404 });
    }

    const version = model.versions[0];

    // ── Read the actual file from disk ──
    let fileBuffer: Buffer | null = null;
    let fileReadError: string | null = null;

    // Try to read from the version's storage path
    if (version.storagePath) {
      try {
        fileBuffer = await readFileFromStorage(version.storagePath);
      } catch {
        fileReadError = `File not found at storage path: ${version.storagePath}`;
      }
    }

    // If no buffer yet and the file size is 0 (no real file uploaded), do a header-less scan
    if (!fileBuffer) {
      if (version.fileSizeBytes > 0 && version.storagePath) {
        // File was supposed to be on disk but we couldn't read it
        fileReadError = fileReadError ?? `Unable to read file from ${version.storagePath}`;
      }
      // Fall back to an empty buffer — the scanner will report findings for empty files
      fileBuffer = Buffer.alloc(0);
    }

    // ── Run the real scanner ──
    const scanResult = scanModelFile({
      buffer: fileBuffer,
      modelName: model.name,
      modelVersion: version.version,
      claimedFormat: model.format,
      sha256Hash: version.sha256Hash,
    });

    // ── Store SBOM in database ──
    const sbom = await db.sbom.upsert({
      where: { versionId: version.id },
      update: {
        contentJson: scanResult.sbomJson,
        totalDeps: scanResult.totalDeps,
        criticalCount: scanResult.criticalCount,
        highCount: scanResult.highCount,
        mediumCount: scanResult.mediumCount,
        lowCount: scanResult.lowCount,
      },
      create: {
        modelId: model.id,
        versionId: version.id,
        contentJson: scanResult.sbomJson,
        totalDeps: scanResult.totalDeps,
        criticalCount: scanResult.criticalCount,
        highCount: scanResult.highCount,
        mediumCount: scanResult.mediumCount,
        lowCount: scanResult.lowCount,
      },
    });

    await db.modelVersion.update({
      where: { id: version.id },
      data: {
        sbomId: sbom.id,
        scanStatus: "completed",
        scanResultJson: JSON.stringify({
          totalFindings:
            scanResult.criticalCount +
            scanResult.highCount +
            scanResult.mediumCount +
            scanResult.lowCount,
          critical: scanResult.criticalCount,
          high: scanResult.highCount,
          medium: scanResult.mediumCount,
          low: scanResult.lowCount,
          fileReadError: fileReadError ?? undefined,
        }),
      },
    });

    await db.model.update({
      where: { id: model.id },
      data: { status: "scanned" },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId: model.orgId || orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "model.scan",
        resourceType: "model",
        resourceId: model.id,
        outcome: "success",
        metadata: JSON.stringify({
          modelId: model.id,
          versionId: version.id,
          sbomId: sbom.id,
          findings: {
            critical: scanResult.criticalCount,
            high: scanResult.highCount,
            medium: scanResult.mediumCount,
            low: scanResult.lowCount,
          },
          fileReadError: fileReadError ?? undefined,
        }),
      },
    });

    return NextResponse.json({
      id: sbom.id,
      modelId: sbom.modelId,
      versionId: sbom.versionId,
      format: sbom.format,
      totalDeps: sbom.totalDeps,
      criticalCount: sbom.criticalCount,
      highCount: sbom.highCount,
      mediumCount: sbom.mediumCount,
      lowCount: sbom.lowCount,
      createdAt: sbom.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Scan model error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}