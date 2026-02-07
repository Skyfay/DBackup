import crypto from "crypto";
import fs from "fs";

const ALGORITHM = "sha256";

/**
 * Calculates a SHA-256 checksum for a file using streaming.
 * This avoids loading the entire file into memory, making it suitable for large backup files.
 *
 * @param filePath - Absolute path to the file
 * @returns Hex-encoded SHA-256 hash string
 */
export function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(ALGORITHM);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }); // 1 MB buffer for large files

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
}

/**
 * Calculates a SHA-256 checksum from a Buffer or string.
 * Useful for verifying small payloads like metadata files.
 *
 * @param data - The data to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export function calculateChecksum(data: Buffer | string): string {
  return crypto.createHash(ALGORITHM).update(data).digest("hex");
}

/**
 * Verifies a file against an expected checksum.
 *
 * @param filePath - Absolute path to the file to verify
 * @param expectedChecksum - The expected hex-encoded SHA-256 hash
 * @returns Object with match result and actual checksum
 */
export async function verifyFileChecksum(
  filePath: string,
  expectedChecksum: string
): Promise<{ valid: boolean; actual: string; expected: string }> {
  const actual = await calculateFileChecksum(filePath);
  return {
    valid: actual === expectedChecksum,
    actual,
    expected: expectedChecksum,
  };
}
