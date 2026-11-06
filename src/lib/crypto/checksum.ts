import crypto from "crypto";
import { createNoFollowReadStream } from "@/lib/server/no-follow";

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
    const stream = createNoFollowReadStream(filePath, { highWaterMark: 1024 * 1024 }); // 1 MB buffer for large files

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
 * Calculates both SHA-256 and MD5 checksums for a file in a single streaming pass.
 * More efficient than calling calculateFileChecksum() twice for large backup files.
 *
 * @param filePath - Absolute path to the file
 * @returns Object with hex-encoded sha256 and md5 hash strings
 */
export function calculateFileChecksums(filePath: string): Promise<{ sha256: string; md5: string }> {
  return new Promise((resolve, reject) => {
    const sha256 = crypto.createHash("sha256");
    const md5 = crypto.createHash("md5");
    const stream = createNoFollowReadStream(filePath, { highWaterMark: 1024 * 1024 });

    stream.on("data", (chunk) => {
      sha256.update(chunk);
      md5.update(chunk);
    });
    stream.on("end", () => resolve({ sha256: sha256.digest("hex"), md5: md5.digest("hex") }));
    stream.on("error", (err) => reject(err));
  });
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
