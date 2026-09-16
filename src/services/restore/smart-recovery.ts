import { createReadStream } from "fs";
import crypto from "crypto";
import { CompressionType } from "@/lib/crypto/compression";
import {
    KeyOverride,
    KeyResolutionLog,
    KeyVerifier,
    resolveBackupKey,
} from "@/services/backup/key-resolution";
import { BackupMetadata } from "@/lib/core/interfaces";

type LogFn = KeyResolutionLog;

/** The two values needed to attempt a decryption. A backup's profile id is not one of them. */
type StreamCipherParams = Pick<NonNullable<BackupMetadata['encryption']>, 'iv' | 'authTag'>;

/**
 * Verifier for a backup encrypted as one stream - every database dump, and the config
 * backup. See `checkKeyCandidate` for why this is a heuristic rather than a proof.
 */
export function legacyStreamVerifier(
    encryptionMeta: StreamCipherParams,
    tempFile: string,
    compressionMeta: CompressionType | undefined,
): KeyVerifier {
    return (candidate: Buffer) => checkKeyCandidate(candidate, encryptionMeta, tempFile, compressionMeta);
}

/**
 * Resolves the master key for a whole-file encrypted backup.
 *
 * A thin binding of the shared resolver to this format's verifier - the ordering, the
 * Smart Recovery walk and the error it raises all live in `resolveBackupKey`.
 */
// LEGACY-FORMAT(shared): Key discovery for whole-file encryption. Older database backups and config
// backups both depend on it.
export async function resolveDecryptionKey(
    encryptionMeta: NonNullable<BackupMetadata['encryption']>,
    tempFile: string,
    compressionMeta: CompressionType | undefined,
    log: LogFn,
    override?: KeyOverride,
): Promise<Buffer> {
    return resolveBackupKey({
        profileId: encryptionMeta.profileId,
        override,
        verify: legacyStreamVerifier(encryptionMeta, tempFile, compressionMeta),
        log,
    });
}

/** How many leading bytes of a backup are enough to judge a candidate key. */
export const HEAD_PROBE_SIZE = 1024;

/**
 * Same check against bytes already in hand, for callers that fetched the head themselves
 * rather than having the whole backup on disk - a ranged read from a storage adapter, say.
 */
// LEGACY-FORMAT(shared): Serves older database backups and config backups alike.
export function legacyHeadVerifier(
    encryptionMeta: StreamCipherParams,
    head: Buffer,
    compressionMeta: CompressionType | undefined,
): KeyVerifier {
    return async (candidate: Buffer) => checkDecryptedHead(candidate, encryptionMeta, head, compressionMeta);
}

/**
 * Heuristic check whether a candidate key successfully decrypts the first KB of the file.
 *
 * Strategy: Read the first 1 KB of the encrypted file, then call `crypto.Decipher.update()`
 * directly (NOT `final()`). This avoids AES-256-GCM auth-tag verification, which covers the
 * full ciphertext and always fails on a partial slice. The decrypted bytes are then checked
 * with content heuristics:
 *
 * - GZIP: valid decryption produces 0x1f 0x8b magic bytes.
 * - BROTLI / no compression: valid decryption produces >70% printable ASCII.
 */
function checkKeyCandidate(
    candidateKey: Buffer,
    encryptionMeta: StreamCipherParams,
    tempFile: string,
    compressionMeta: CompressionType | undefined,
): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const chunks: Buffer[] = [];
            const input = createReadStream(tempFile, { start: 0, end: HEAD_PROBE_SIZE - 1 });

            input.on('error', () => resolve(false));
            input.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            input.on('end', () => {
                resolve(checkDecryptedHead(candidateKey, encryptionMeta, Buffer.concat(chunks), compressionMeta));
            });
        } catch (_e) {
            resolve(false);
        }
    });
}

/** The judgement itself, once the leading bytes are available. */
function checkDecryptedHead(
    candidateKey: Buffer,
    encryptionMeta: StreamCipherParams,
    head: Buffer,
    compressionMeta: CompressionType | undefined,
): boolean {
    if (head.length === 0) return false;

    try {
        // Use crypto.Decipher.update() directly.
        // We intentionally skip final() so that auth-tag verification is never
        // triggered on this partial 1 KB slice (the tag covers the full file).
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            candidateKey,
            Buffer.from(encryptionMeta.iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(encryptionMeta.authTag, 'hex'));

        return isValidDecryptedContent(decipher.update(head), compressionMeta);
    } catch (_e) {
        return false;
    }
}

/**
 * Checks whether decrypted bytes look like valid backup content.
 *
 * Supported format detection (in order):
 * - GZIP magic (0x1f 0x8b): catches pipeline GZIP compression AND mongodump --gzip archives.
 *   Checked unconditionally so that formats that are inherently gzip (e.g. MongoDB single-DB
 *   archive) are matched even when no pipeline compression is configured (compressionMeta
 *   is undefined).  When compressionMeta IS 'GZIP' and the magic does not match we return
 *   false immediately (wrong key).
 * - PostgreSQL custom format (pg_dump -Fc): file starts with the 5-byte magic "PGDMP".
 *   Applies to all single-DB PostgreSQL backups regardless of the -Z compression level,
 *   because the compression is internal to the custom format and does not change the header.
 * - TAR: POSIX/GNU tar stores "ustar" at header offset 257.  Catches uncompressed .tar.enc
 *   multi-DB archives.
 * - BROTLI or plain SQL dumps: >70% of bytes must be printable ASCII.
 */
function isValidDecryptedContent(chunk: Buffer, compressionMeta: CompressionType | undefined): boolean {
    if (chunk.length < 2) return false;

    // GZIP magic - checked unconditionally so it matches both pipeline GZIP and any
    // format that is inherently gzip (e.g. mongodump --archive --gzip single-DB files).
    if (chunk[0] === 0x1f && chunk[1] === 0x8b) {
        return true;
    }
    // If we expected GZIP but magic is absent the key is wrong.
    if (compressionMeta === 'GZIP') {
        return false;
    }

    // PostgreSQL custom format (pg_dump -Fc): 5-byte ASCII header "PGDMP".
    // This covers ALL single-DB PostgreSQL backups regardless of the -Z compression
    // algorithm (NONE / GZIP / LZ4 / ZSTD / LEGACY) because the native compression is
    // stored inside the custom format - the outer file header is always "PGDMP".
    if (chunk.length >= 5 && chunk.subarray(0, 5).toString('ascii') === 'PGDMP') {
        return true;
    }

    // TAR magic: POSIX/GNU tar writes "ustar" at header offset 257.
    // This catches uncompressed .tar.enc backups (multi-db format).
    if (chunk.length >= 262 && chunk.subarray(257, 262).toString('ascii') === 'ustar') {
        return true;
    }

    // SQLite database file: starts with the fixed 15-byte ASCII string "SQLite format 3"
    // followed by a NUL byte.  The rest of the header is binary, so the >70% ASCII check
    // would fail for an otherwise-correct key.
    if (chunk.length >= 15 && chunk.subarray(0, 15).toString('ascii') === 'SQLite format 3') {
        return true;
    }

    // Redis RDB snapshot: starts with the 5-byte ASCII string "REDIS" followed by a
    // 4-digit version number (e.g. "REDIS0011").  Everything after that is binary BSON-like
    // data, so the >70% ASCII check would not be reliable.
    if (chunk.length >= 5 && chunk.subarray(0, 5).toString('ascii') === 'REDIS') {
        return true;
    }

    // For BROTLI or plain SQL dumps, check for printable ASCII ratio.
    const printable = chunk.filter(b => b >= 0x20 && b <= 0x7e).length;
    return printable / chunk.length > 0.7;
}
