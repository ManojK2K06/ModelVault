import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

/**
 * Ensure the uploads directory exists.
 */
export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

/**
 * Save a file to disk.
 *
 * Path: uploads/{orgId}/{modelId}/{versionId}/{filename}
 * Returns the storage path relative to the project root.
 */
export async function saveFile(
  file: Buffer,
  orgId: string,
  modelId: string,
  versionId: string,
  filename: string
): Promise<string> {
  const dir = path.join(UPLOADS_DIR, orgId, modelId, versionId);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, file);

  // Return path relative to project root
  return path.join("uploads", orgId, modelId, versionId, filename);
}

/**
 * Delete all files for a model from disk.
 * Used during soft-delete cleanup.
 * Does not throw if the directory doesn't exist.
 */
export async function deleteFiles(modelId: string): Promise<number> {
  // We need to find the org directory that contains this modelId
  // Walk the uploads dir to find {orgId}/{modelId}/
  let deletedCount = 0;

  try {
    const orgDirs = await fs.readdir(UPLOADS_DIR);
    for (const orgDir of orgDirs) {
      const orgPath = path.join(UPLOADS_DIR, orgDir);
      const stat = await fs.stat(orgPath);
      if (!stat.isDirectory()) continue;

      const modelDir = path.join(orgPath, modelId);
      try {
        const modelStat = await fs.stat(modelDir);
        if (modelStat.isDirectory()) {
          await fs.rm(modelDir, { recursive: true, force: true });
          deletedCount++;
        }
      } catch {
        // Model dir doesn't exist under this org, skip
      }
    }
  } catch {
    // Uploads dir doesn't exist, nothing to delete
  }

  return deletedCount;
}

/**
 * Get the size of a file in bytes.
 * Returns 0 if the file doesn't exist.
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Calculate the SHA-256 hash of a buffer.
 * Returns a hex string.
 */
export function calculateSHA256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Calculate the SHA-512 hash of a buffer.
 * Returns a hex string.
 */
export function calculateSHA512(buffer: Buffer): string {
  return createHash("sha512").update(buffer).digest("hex");
}

/**
 * Compute a simple binary Merkle tree root from chunk hashes.
 *
 * If there is only one chunk, return that hash.
 * If odd number of chunks, duplicate the last one before each round.
 * Each round concatenates pairs and hashes them.
 */
export function calculateMerkleRoot(chunks: string[]): string {
  if (chunks.length === 0) {
    return createHash("sha256").update("empty").digest("hex");
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  let nodes = [...chunks];

  while (nodes.length > 1) {
    // If odd, duplicate last
    if (nodes.length % 2 !== 0) {
      nodes.push(nodes[nodes.length - 1]);
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const combined = nodes[i] + nodes[i + 1];
      nextLevel.push(createHash("sha256").update(combined).digest("hex"));
    }
    nodes = nextLevel;
  }

  return nodes[0];
}

/**
 * Get total storage used by an organization (sum of all file sizes in their upload dir).
 */
export async function getOrgStorageUsed(orgId: string): Promise<number> {
  const orgDir = path.join(UPLOADS_DIR, orgId);
  let totalBytes = 0;

  try {
    totalBytes = await sumDirSize(orgDir);
  } catch {
    // Directory doesn't exist yet
  }

  return totalBytes;
}

/**
 * Recursively sum file sizes in a directory.
 */
async function sumDirSize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await sumDirSize(fullPath);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }

  return total;
}

/**
 * Calculate hashes for a file buffer by splitting into chunks.
 * Returns SHA-256 of the full file, SHA-512, and a Merkle root.
 */
export function calculateFileHashes(
  fileBuffer: Buffer,
  chunkSizeBytes: number = 1024 * 1024 // 1 MB default chunks
): {
  sha256Hash: string;
  sha512Hash: string;
  merkleRoot: string;
} {
  const sha256Hash = calculateSHA256(fileBuffer);
  const sha512Hash = calculateSHA512(fileBuffer);

  // Split into chunks for Merkle tree
  const chunkHashes: string[] = [];
  for (let offset = 0; offset < fileBuffer.length; offset += chunkSizeBytes) {
    const end = Math.min(offset + chunkSizeBytes, fileBuffer.length);
    const chunk = fileBuffer.subarray(offset, end);
    chunkHashes.push(calculateSHA256(chunk));
  }

  const merkleRoot = calculateMerkleRoot(chunkHashes);

  return { sha256Hash, sha512Hash, merkleRoot };
}