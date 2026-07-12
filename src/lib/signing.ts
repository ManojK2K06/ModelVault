import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const KEYS_DIR = path.join(process.cwd(), "signing-keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "public.pem");

/**
 * Generate a new Ed25519 key pair.
 * Returns PEM-encoded strings (SPKI for public, PKCS8 for private).
 */
export function generateKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

/**
 * Sign a SHA-256 hash (hex string) using Ed25519.
 * Uses crypto.sign directly since Ed25519 is not compatible with createSign.
 * Returns a base64-encoded signature.
 */
export function signHash(
  sha256Hex: string,
  privateKeyPem: string
): string {
  const data = Buffer.from(sha256Hex, "hex");
  const signature = crypto.sign(null, data, privateKeyPem);
  return signature.toString("base64");
}

/**
 * Verify an Ed25519 signature against a SHA-256 hash.
 * Uses crypto.verify directly since Ed25519 is not compatible with createVerify.
 */
export function verifySignature(
  sha256Hex: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const data = Buffer.from(sha256Hex, "hex");
  const signature = Buffer.from(signatureBase64, "base64");
  try {
    return crypto.verify(null, data, publicKeyPem, signature);
  } catch {
    return false;
  }
}

/**
 * Load or generate the signing key pair.
 *
 * - If signing-keys/private.pem exists, reads both keys from disk.
 * - Otherwise, generates a new Ed25519 pair and saves both files.
 *
 * Returns PEM-encoded strings for both keys.
 */
export async function getSigningKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  // Ensure the directory exists
  await fs.mkdir(KEYS_DIR, { recursive: true });

  // Check if keys already exist
  try {
    const [privatePem, publicPem] = await Promise.all([
      fs.readFile(PRIVATE_KEY_PATH, "utf-8"),
      fs.readFile(PUBLIC_KEY_PATH, "utf-8"),
    ]);

    return { publicKey: publicPem, privateKey: privatePem };
  } catch {
    // Keys don't exist yet — generate them
  }

  const keyPair = generateKeyPair();

  await Promise.all([
    fs.writeFile(PRIVATE_KEY_PATH, keyPair.privateKey, { mode: 0o600 }),
    fs.writeFile(PUBLIC_KEY_PATH, keyPair.publicKey, { mode: 0o644 }),
  ]);

  return keyPair;
}