import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySignature } from "@/lib/signing";
import { calculateSHA256 } from "@/lib/storage";
import { promises as fs } from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const model = await db.model.findUnique({
      where: { id, deletedAt: null },
      include: {
        versions: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });

    if (!model || model.versions.length === 0) {
      return NextResponse.json(
        { valid: false, error: "Model or version not found" },
        { status: 404 }
      );
    }

    const version = model.versions[0];

    // Look up the signature for this version
    const signature = await db.signature.findUnique({
      where: { versionId: version.id },
    });

    if (!signature) {
      return NextResponse.json({
        valid: false,
        error: "No signature found",
      });
    }

    // Re-hash the file from disk
    const storagePath = path.join(process.cwd(), version.storagePath);
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(storagePath);
    } catch {
      return NextResponse.json({
        valid: false,
        error: "File not found on disk",
      });
    }

    const currentHash = calculateSHA256(fileBuffer);

    // Verify the stored signature against the current file hash
    // We need the public key that was stored with the signature
    const publicKeyPem = signature.certificatePem;
    if (!publicKeyPem) {
      return NextResponse.json({
        valid: false,
        error: "No public key stored with signature",
      });
    }

    const valid = verifySignature(currentHash, signature.signatureValue, publicKeyPem);

    // Also check if the hash has changed (tamper detection)
    const hashMatch = currentHash === version.sha256Hash;

    return NextResponse.json({
      valid: valid && hashMatch,
      signer: signature.signerIdentity,
      signerEmail: signature.signerEmail,
      algorithm: "Ed25519" as const,
      hash: currentHash,
      originalHash: version.sha256Hash,
      hashMatch,
      signatureVerified: valid,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Verify signature error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}