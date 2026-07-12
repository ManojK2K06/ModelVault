import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId, getDemoUserId } from "@/lib/demo-helpers";
import {
  ensureUploadDir,
  saveFile,
  calculateFileHashes,
} from "@/lib/storage";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const url = new URL(req.url);
    const search = url.searchParams.get("search") ?? "";
    const status = url.searchParams.get("status");
    const format = url.searchParams.get("format");
    const scanStatus = url.searchParams.get("scanStatus");
    const cursor = url.searchParams.get("cursor");
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const where: Record<string, unknown> = {
      orgId,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }
    if (status) {
      where.status = status;
    }
    if (format) {
      where.format = format;
    }

    // If scanStatus filter, we need to join on the version's scanStatus
    let models;
    if (scanStatus) {
      models = await db.model.findMany({
        where: {
          ...where,
          versions: {
            some: {
              id: {
                in: (
                  await db.modelVersion.findMany({
                    where: { scanStatus, model: where },
                    select: { modelId: true },
                    distinct: ["modelId"],
                  })
                ).map((v) => v.modelId),
              },
            },
          },
        } as never,
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          versions: {
            orderBy: { uploadedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    } else {
      models = await db.model.findMany({
        where: where as never,
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          versions: {
            orderBy: { uploadedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    }

    const hasMore = models.length > limit;
    const items = hasMore ? models.slice(0, limit) : models;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const formatted = items.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      format: m.format,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      createdBy: m.createdBy,
      latestVersion: m.versions[0]
        ? {
            id: m.versions[0].id,
            version: m.versions[0].version,
            fileSizeBytes: m.versions[0].fileSizeBytes,
            scanStatus: m.versions[0].scanStatus,
            uploadedAt: m.versions[0].uploadedAt.toISOString(),
          }
        : null,
    }));

    return NextResponse.json({
      items: formatted,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("List models error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const userId = await getDemoUserId();

    // ── Try to parse as multipart form data first ──
    const contentType = req.headers.get("content-type") ?? "";
    let fileBuffer: Buffer | null = null;
    let originalFilename = "model.bin";
    let name = "";
    let description: string | null = null;
    let sourceUrl: string | null = null;
    let format = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (file && file instanceof File) {
        fileBuffer = Buffer.from(await file.arrayBuffer());
        originalFilename = file.name;

        // Clean filename for storage
        originalFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
      }

      name = (formData.get("name") as string) ?? "";
      description = (formData.get("description") as string) ?? null;
      sourceUrl = (formData.get("sourceUrl") as string) ?? null;
      format = (formData.get("format") as string) ?? "";

      // Infer format from file extension if not provided
      if (!format && file && file instanceof File) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext) {
          const extToFormat: Record<string, string> = {
            safetensors: "safetensors",
            gguf: "gguf",
            onnx: "onnx",
            bin: "bin",
            pt: "pytorch",
            pth: "pytorch",
            h5: "hdf5",
            ckpt: "checkpoint",
          };
          format = extToFormat[ext] ?? ext;
        }
      }
    } else {
      // ── Legacy JSON body (backward compatible) ──
      const body = await req.json();
      name = body.name ?? "";
      description = body.description ?? null;
      sourceUrl = body.sourceUrl ?? null;
      format = body.format ?? "";
    }

    if (!name || !format) {
      return NextResponse.json(
        { error: "Name and format are required" },
        { status: 400 }
      );
    }

    // ── Create model record ──
    const model = await db.model.create({
      data: {
        orgId,
        name,
        description,
        sourceUrl,
        format,
        status: "uploading",
        createdById: userId,
      },
    });

    // ── Create version record ──
    let versionData: {
      modelId: string;
      version: string;
      fileSizeBytes: number;
      sha256Hash: string;
      sha512Hash: string;
      merkleRoot: string;
      storagePath: string;
      scanStatus: string;
    };

    if (fileBuffer && fileBuffer.length > 0) {
      // ── Real file upload path ──
      const version = await db.modelVersion.create({
        data: {
          modelId: model.id,
          version: "v1.0.0",
          fileSizeBytes: 0,
          sha256Hash: "",
          sha512Hash: "",
          merkleRoot: "",
          storagePath: "",
          scanStatus: "pending",
        },
      });

      // Calculate hashes
      const hashes = calculateFileHashes(fileBuffer);

      // Save file to disk
      await ensureUploadDir();
      const storagePath = await saveFile(
        fileBuffer,
        orgId,
        model.id,
        version.id,
        originalFilename
      );

      // Update version with real data
      const updatedVersion = await db.modelVersion.update({
        where: { id: version.id },
        data: {
          fileSizeBytes: fileBuffer.length,
          sha256Hash: hashes.sha256Hash,
          sha512Hash: hashes.sha512Hash,
          merkleRoot: hashes.merkleRoot,
          storagePath,
        },
      });

      // Update model with latest version
      await db.model.update({
        where: { id: model.id },
        data: { latestVersionId: version.id, status: "uploaded" },
      });

      versionData = {
        modelId: updatedVersion.modelId,
        version: updatedVersion.version,
        fileSizeBytes: updatedVersion.fileSizeBytes,
        sha256Hash: updatedVersion.sha256Hash,
        sha512Hash: updatedVersion.sha512Hash,
        merkleRoot: updatedVersion.merkleRoot,
        storagePath: updatedVersion.storagePath,
        scanStatus: updatedVersion.scanStatus,
      };

      // Refresh model to get updated status/timestamps
      const refreshedModel = await db.model.findUnique({
        where: { id: model.id },
      });
      const finalModel = refreshedModel ?? model;

      return NextResponse.json(
        {
          id: finalModel.id,
          name: finalModel.name,
          description: finalModel.description,
          format: finalModel.format,
          status: finalModel.status,
          createdAt: finalModel.createdAt.toISOString(),
          updatedAt: finalModel.updatedAt.toISOString(),
          latestVersion: {
            id: version.id,
            ...versionData,
            uploadedAt: version.uploadedAt.toISOString(),
          },
        },
        { status: 201 }
      );
    } else {
      // ── Metadata-only path: DB record with no file ──
      const version = await db.modelVersion.create({
        data: {
          modelId: model.id,
          version: "v1.0.0",
          fileSizeBytes: 0,
          sha256Hash: "",
          scanStatus: "pending",
        },
      });

      await db.model.update({
        where: { id: model.id },
        data: { latestVersionId: version.id },
      });

      return NextResponse.json(
        {
          id: model.id,
          name: model.name,
          description: model.description,
          format: model.format,
          status: model.status,
          createdAt: model.createdAt.toISOString(),
          updatedAt: model.updatedAt.toISOString(),
          latestVersion: {
            id: version.id,
            version: version.version,
            fileSizeBytes: version.fileSizeBytes,
            scanStatus: version.scanStatus,
            uploadedAt: version.uploadedAt.toISOString(),
          },
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error("Create model error:", error);

    // Handle specific errors
    if (error instanceof Error) {
      if (error.message.includes("ENOSPC")) {
        return NextResponse.json(
          { error: "Disk full. Cannot save file." },
          { status: 507 }
        );
      }
      if (error.message.includes("EACCES")) {
        return NextResponse.json(
          { error: "Permission denied. Cannot write to storage." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}