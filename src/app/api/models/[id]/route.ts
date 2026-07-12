import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteFiles } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [model, signatures, sboms, sandboxJobs] = await Promise.all([
      db.model.findFirst({
        where: { id, deletedAt: null },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          versions: {
            orderBy: { uploadedAt: "desc" },
          },
        },
      }),
      db.signature.findMany({
        where: { modelId: id },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          signer: { select: { id: true, name: true, email: true } },
        },
      }),
      db.sbom.findMany({
        where: { modelId: id },
        orderBy: { createdAt: "desc" },
        take: 1,
      }),
      db.sandboxJob.findMany({
        where: { modelId: id },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          submittedByUser: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // Build a map of signatureId -> signature and sbomId -> sbom for version enrichment
    const sigMap = new Map(signatures.map((s) => [s.versionId, s]));
    const sbomMap = new Map(sboms.map((s) => [s.versionId, s]));

    const latestSignature = signatures[0] ?? null;
    const latestSbom = sboms[0] ?? null;
    const latestSandboxJob = sandboxJobs[0] ?? null;

    return NextResponse.json({
      id: model.id,
      name: model.name,
      description: model.description,
      sourceUrl: model.sourceUrl,
      format: model.format,
      status: model.status,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
      createdBy: model.createdBy,
      versions: model.versions.map((v) => ({
        id: v.id,
        version: v.version,
        fileSizeBytes: v.fileSizeBytes,
        sha256Hash: v.sha256Hash,
        scanStatus: v.scanStatus,
        scanResultJson: v.scanResultJson,
        uploadedAt: v.uploadedAt.toISOString(),
        signature: sigMap.get(v.id)
          ? {
              id: sigMap.get(v.id)!.id,
              signerEmail: sigMap.get(v.id)!.signerEmail,
              verifiedAt: sigMap.get(v.id)!.verifiedAt?.toISOString() ?? null,
              createdAt: sigMap.get(v.id)!.createdAt.toISOString(),
            }
          : null,
        sbom: sbomMap.get(v.id)
          ? {
              id: sbomMap.get(v.id)!.id,
              totalDeps: sbomMap.get(v.id)!.totalDeps,
              criticalCount: sbomMap.get(v.id)!.criticalCount,
              highCount: sbomMap.get(v.id)!.highCount,
              mediumCount: sbomMap.get(v.id)!.mediumCount,
              lowCount: sbomMap.get(v.id)!.lowCount,
              createdAt: sbomMap.get(v.id)!.createdAt.toISOString(),
            }
          : null,
      })),
      latestSignature: latestSignature
        ? {
            id: latestSignature.id,
            signerEmail: latestSignature.signerEmail,
            signerIdentity: latestSignature.signerIdentity,
            verifiedAt: latestSignature.verifiedAt?.toISOString() ?? null,
            createdAt: latestSignature.createdAt.toISOString(),
            signer: latestSignature.signer,
          }
        : null,
      latestSbom: latestSbom
        ? {
            id: latestSbom.id,
            format: latestSbom.format,
            totalDeps: latestSbom.totalDeps,
            criticalCount: latestSbom.criticalCount,
            highCount: latestSbom.highCount,
            mediumCount: latestSbom.mediumCount,
            lowCount: latestSbom.lowCount,
            createdAt: latestSbom.createdAt.toISOString(),
          }
        : null,
      latestSandboxJob: latestSandboxJob
        ? {
            id: latestSandboxJob.id,
            status: latestSandboxJob.status,
            resultJson: latestSandboxJob.resultJson,
            durationMs: latestSandboxJob.durationMs,
            createdAt: latestSandboxJob.createdAt.toISOString(),
            submittedBy: latestSandboxJob.submittedByUser,
          }
        : null,
    });
  } catch (error) {
    console.error("Get model error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const model = await db.model.findFirst({
      where: { id, deletedAt: null },
      include: {
        versions: {
          select: { fileSizeBytes: true },
        },
      },
    });

    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // Soft-delete the model
    await db.model.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Delete files from disk (fire-and-forget, non-blocking)
    deleteFiles(id).catch((err) => {
      console.error(`Failed to delete files for model ${id}:`, err);
    });

    return NextResponse.json({
      success: true,
      filesDeleted: true,
    });
  } catch (error) {
    console.error("Delete model error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}