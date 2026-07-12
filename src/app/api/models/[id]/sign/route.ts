import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/demo-helpers";
import { getSigningKeys, signHash } from "@/lib/signing";
import { calculateSHA256 } from "@/lib/storage";
import { promises as fs } from "fs";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthContext(req);

    const model = await db.model.findUnique({
      where: { id, deletedAt: null },
      include: {
        versions: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });

    if (!model || model.versions.length === 0) {
      return NextResponse.json(
        { error: "Model or version not found" },
        { status: 404 }
      );
    }

    const version = model.versions[0];
    const user = await db.user.findUnique({ where: { id: auth.userId } });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Resolve the SHA-256 hash to sign
    let sha256Hash = version.sha256Hash;

    // If no hash was stored at upload time, compute it from the file on disk
    if (!sha256Hash) {
      const storagePath = path.join(process.cwd(), version.storagePath);
      try {
        const fileBuffer = await fs.readFile(storagePath);
        sha256Hash = calculateSHA256(fileBuffer);

        // Persist the computed hash back to the version record
        await db.modelVersion.update({
          where: { id: version.id },
          data: { sha256Hash },
        });
      } catch {
        return NextResponse.json(
          { error: "File not found on disk and no stored hash available" },
          { status: 400 }
        );
      }
    }

    // Load or generate the Ed25519 signing key pair
    const { publicKey, privateKey } = await getSigningKeys();

    // Sign the SHA-256 hash with Ed25519
    const signatureValue = signHash(sha256Hash, privateKey);

    // Use upsert to handle re-signing (versionId is unique on Signature)
    const signature = await db.signature.upsert({
      where: { versionId: version.id },
      update: {
        signerId: auth.userId,
        signerEmail: user.email,
        signerIdentity: "ModelVault Local",
        signatureValue,
        certificatePem: publicKey,
        verifiedAt: new Date(),
      },
      create: {
        modelId: model.id,
        versionId: version.id,
        signerId: auth.userId,
        signerEmail: user.email,
        signerIdentity: "ModelVault Local",
        signatureValue,
        certificatePem: publicKey,
        verifiedAt: new Date(),
      },
    });

    await db.modelVersion.update({
      where: { id: version.id },
      data: { signatureId: signature.id },
    });

    await db.model.update({
      where: { id: model.id },
      data: { status: "signed" },
    });

    await db.auditLog.create({
      data: {
        orgId: model.orgId || auth.orgId,
        userId: auth.userId,
        actor: user.email,
        action: "model.sign",
        resourceType: "model",
        resourceId: model.id,
        outcome: "success",
        metadata: JSON.stringify({
          modelId: model.id,
          versionId: version.id,
          signatureId: signature.id,
          algorithm: "Ed25519",
          hash: sha256Hash,
        }),
      },
    });

    return NextResponse.json({
      id: signature.id,
      modelId: signature.modelId,
      versionId: signature.versionId,
      signerEmail: signature.signerEmail,
      signerIdentity: signature.signerIdentity,
      algorithm: "Ed25519",
      hash: sha256Hash,
      verifiedAt: signature.verifiedAt?.toISOString(),
      createdAt: signature.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Sign model error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}