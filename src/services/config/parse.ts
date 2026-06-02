import { AppConfigurationBackup } from "@/lib/types/config-backup";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { createGunzip } from "zlib";
import { createReadStream, promises as fs } from "fs";
import { Readable, Transform } from "stream";
import { resolveDecryptionKey } from "@/services/restore/smart-recovery";
import { pipeline } from "stream/promises";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const svcLog = logger.child({ service: "ConfigService" });

/**
 * Parses a raw backup file (potentially encrypted/compressed) into a JSON object.
 * Helper for Offline Config Restore.
 */
export async function parseBackupFile(
  filePath: string,
  metaFilePath?: string,
  rawKeyHex?: string
): Promise<AppConfigurationBackup> {
  let iv: Buffer | undefined;
  let authTag: Buffer | undefined;
  let profileId: string | undefined;
  let isCompressed = false;
  let isEncrypted = false;

  // 1. Try to read metadata if provided
  if (metaFilePath && await fs
    .stat(metaFilePath)
    .then(() => true)
    .catch(() => false)) {
    try {
      const metaContent = await fs.readFile(metaFilePath, 'utf-8');
      const meta = JSON.parse(metaContent);

      // 1. Detect Encryption Metadata (Standard vs Flat)
      if (meta.encryption && typeof meta.encryption === 'object' && meta.encryption.enabled) {
        // Standard Nested Format
        if (meta.encryption.iv) iv = Buffer.from(meta.encryption.iv, 'hex');
        if (meta.encryption.authTag) authTag = Buffer.from(meta.encryption.authTag, 'hex');
        if (meta.encryption.profileId) profileId = meta.encryption.profileId;
        isEncrypted = true;
      } else {
        // Legacy Flat Format
        if (meta.iv) iv = Buffer.from(meta.iv, 'hex');
        if (meta.authTag) authTag = Buffer.from(meta.authTag, 'hex');
        profileId = meta.encryptionProfileId;
        if (meta.encryption && meta.encryption !== 'NONE') isEncrypted = true;
      }

      if (meta.compression === 'GZIP') isCompressed = true;
    } catch (e: unknown) {
      svcLog.warn("Failed to parse metadata file", {}, wrapError(e));
    }
  } else {
    // Fallback: Guess by extension
    if (filePath.endsWith('.gz') || filePath.endsWith('.br')) isCompressed = await detectCompression(filePath);
  }

  // Auto-detect extension based fallback if meta failed/missing
  if (!isCompressed && filePath.endsWith('.gz')) isCompressed = true;
  if (!isEncrypted && filePath.endsWith('.enc')) isEncrypted = true;

  const streams: (Readable | Transform)[] = [createReadStream(filePath)];

  if (isEncrypted) {
    if (!iv || !authTag || !profileId) {
      throw new Error("Encrypted backup detected but metadata (IV/AuthTag/Profile) is missing. Please upload the .meta.json file as well.");
    }

    let key: Buffer;
    if (rawKeyHex) {
      // Caller-supplied raw key override (e.g. from manual key resolution UI)
      if (!/^[0-9a-fA-F]{64}$/.test(rawKeyHex)) {
        throw new Error("Invalid encryption key format. Must be a 64-character hex string.");
      }
      key = Buffer.from(rawKeyHex, 'hex');
    } else {
      // Auto-resolve: try vault profile first, then Smart Recovery (try all profiles)
      const encryptionMeta = {
        enabled: true as const,
        profileId,
        algorithm: 'aes-256-gcm' as const,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
      };
      try {
        key = await resolveDecryptionKey(
          encryptionMeta,
          filePath,
          isCompressed ? 'GZIP' : undefined,
          (msg) => svcLog.info(msg, {}),
        );
      } catch {
        throw new Error(`ENCRYPTION_KEY_REQUIRED:${profileId}`);
      }
    }

    streams.push(createDecryptionStream(key, iv, authTag));
  }

  if (isCompressed) {
    streams.push(createGunzip());
  }

  // Collect stream to buffer
  let jsonString = '';
  const collector = new Transform({
    transform(chunk, encoding, callback) {
      jsonString += chunk.toString();
      callback();
    }
  });
  streams.push(collector);

  try {
    // @ts-expect-error Pipeline argument spread issues
    await pipeline(...streams);
    return JSON.parse(jsonString) as AppConfigurationBackup;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to process backup file: ${message}`);
  }
}

// Helper (Placeholder for real detection if needed, mostly extension is enough)
async function detectCompression(file: string): Promise<boolean> {
  return file.endsWith('.gz');
}

/**
 * Attempts to decrypt (and decompress) a downloaded config backup file with a candidate key.
 * Returns the decrypted JSON string on success, or null on failure.
 */
export async function tryDecryptFile(
  downloadPath: string,
  candidateKey: Buffer,
  meta: any,
  isCompressed: boolean
): Promise<string | null> {
  const ivHex = meta?.encryption?.iv || meta?.iv;
  const authTagHex = meta?.encryption?.authTag || meta?.authTag;

  if (!ivHex || !authTagHex) return null;

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const streams: (Readable | Transform)[] = [createReadStream(downloadPath)];
    streams.push(createDecryptionStream(candidateKey, iv, authTag));
    if (isCompressed) streams.push(createGunzip());

    const chunks: Buffer[] = [];
    const collector = new Transform({
      transform(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    streams.push(collector);

    // @ts-expect-error Pipeline argument spread issues
    await pipeline(...streams);
    const content = Buffer.concat(chunks).toString('utf8').trim();

    // Validate: must be valid JSON
    if (content.startsWith('{') || content.startsWith('[')) {
      return content;
    }
    return null;
  } catch {
    return null;
  }
}
