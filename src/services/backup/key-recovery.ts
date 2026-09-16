/**
 * Taking a key the user holds and making it one the system holds.
 *
 * When a backup's encryption profile is gone, the key itself usually is not - it is in a
 * Recovery Kit, a password manager, or another instance's vault. The old answer was to use
 * such a key for one operation and forget it, which meant every later step asked again, and
 * anything running unattended (a scheduled restore, a background config restore) could never
 * benefit from it at all.
 *
 * So the key is imported instead. Once it is a vault profile, nothing downstream needs to
 * know a recovery happened: the profile the backup names is still missing, but Smart
 * Recovery now finds a profile that fits, everywhere, including in the background.
 *
 * Verifying before importing is the point of doing this here rather than in the vault page.
 * A key that does not open this backup would otherwise be stored as though it did, and the
 * next restore would fail with something far less obvious than "that is the wrong key".
 */

import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { BackupMetadata, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getTempDir } from "@/lib/temp-dir";
import { CompressionType } from "@/lib/crypto/compression";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HEAD_PROBE_SIZE, legacyHeadVerifier } from "@/services/restore/smart-recovery";
import { archiveIndexService } from "./archive-index-service";
import { archiveIndexVerifier, KeyVerifier } from "./key-resolution";
import {
    getEncryptionProfiles,
    getProfileMasterKey,
    importEncryptionProfile,
} from "./encryption-service";

const log = logger.child({ service: "KeyRecoveryService" });

const MASTER_KEY_HEX = /^[0-9a-fA-F]{64}$/;

export interface KeyRecoveryResult {
    /** The key does not open this backup. Nothing was stored. */
    status: "rejected" | "imported" | "existing";
    profileId?: string;
    profileName?: string;
}

/**
 * Checks a key against one backup and, if it fits, stores it as a vault profile.
 *
 * @param storageConfigId - Storage adapter holding the backup
 * @param file - Remote path of the backup, without any sidecar suffix
 * @param keyHex - The 32-byte master key as 64 hex characters
 * @param name - Profile name to store it under. Generated from the backup when omitted.
 */
export async function recoverEncryptionKey(
    storageConfigId: string,
    file: string,
    keyHex: string,
    name?: string
): Promise<KeyRecoveryResult> {
    const clean = keyHex.trim();
    if (!MASTER_KEY_HEX.test(clean)) {
        throw new ValidationError(
            "Invalid encryption key format. Must be a 64-character hex string (32 bytes).",
            { field: "keyHex" }
        );
    }
    const candidate = Buffer.from(clean, "hex");

    const { adapter, config, meta } = await readBackup(storageConfigId, file);
    const verify = await buildVerifier(adapter, config, storageConfigId, file, meta);

    if (!(await verify(candidate))) {
        return { status: "rejected" };
    }

    // A key already in the vault under some other name is not a second profile. Silently
    // creating one would leave two entries holding the same secret, and deleting either
    // would then look safe when it is not.
    const existing = await findProfileWithKey(candidate);
    if (existing) {
        log.info("Recovered key already present in the vault", { profileId: existing.id });
        return { status: "existing", profileId: existing.id, profileName: existing.name };
    }

    const profile = await importEncryptionProfile(
        await uniqueProfileName(name?.trim() || suggestedProfileName(meta, file)),
        clean,
        `Recovered while opening ${path.basename(file)}.`
    );

    log.info("Imported a recovered key into the vault", { profileId: profile.id });
    return { status: "imported", profileId: profile.id, profileName: profile.name };
}

/** Resolves the adapter and reads the backup's metadata sidecar. */
async function readBackup(storageConfigId: string, file: string) {
    const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
    if (!storageConfig || storageConfig.type !== "storage") {
        throw new NotFoundError("Storage adapter", storageConfigId);
    }

    const adapter = registry.get(storageConfig.adapterId) as StorageAdapter | undefined;
    if (!adapter) {
        throw new NotFoundError("Storage adapter implementation", storageConfig.adapterId);
    }

    const config = await resolveAdapterConfig(storageConfig);
    const meta = await readMeta(adapter, config, file);
    if (!meta) {
        throw new NotFoundError("Backup metadata", `${file}.meta.json`);
    }

    return { adapter, config, meta };
}

async function readMeta(
    adapter: StorageAdapter,
    config: Awaited<ReturnType<typeof resolveAdapterConfig>>,
    file: string
): Promise<BackupMetadata | null> {
    const remotePath = `${file}.meta.json`;

    if (adapter.read) {
        try {
            const content = await adapter.read(config, remotePath);
            if (content) return JSON.parse(content) as BackupMetadata;
        } catch { /* fall through to the download */ }
    }

    const tempFile = path.join(getTempDir(), `key-recovery-${process.pid}-${crypto.randomUUID()}.json`);
    try {
        if (!(await adapter.download(config, remotePath, tempFile).catch(() => false))) return null;
        return JSON.parse(await fs.readFile(tempFile, "utf-8")) as BackupMetadata;
    } catch {
        return null;
    } finally {
        await fs.unlink(tempFile).catch(() => { });
    }
}

/**
 * Picks the check that suits this backup's format.
 *
 * A v2 archive is decided exactly, by whether its sealed index opens. Everything else falls
 * back to the content heuristic over the backup's first kilobyte, which is why the UI must
 * not promise more certainty than that for those formats.
 */
async function buildVerifier(
    adapter: StorageAdapter,
    config: Awaited<ReturnType<typeof resolveAdapterConfig>>,
    storageConfigId: string,
    file: string,
    meta: BackupMetadata
): Promise<KeyVerifier> {
    if (meta.archive?.formatVersion === 2) {
        if (!meta.archive.encrypted) {
            throw new ValidationError("This backup is not encrypted, so it needs no key.", { field: "file" });
        }
        if (!meta.archive.kdfSalt || !meta.archive.noncePrefix) {
            throw new ValidationError(
                "This backup's metadata is missing the parameters needed to test a key against it.",
                { field: "file" }
            );
        }

        const sidecar = await archiveIndexService.fetchSidecar(storageConfigId, file, meta.archive.indexFile);
        if (!sidecar) {
            throw new NotFoundError("Archive index sidecar", `${file}${meta.archive.indexFile}`);
        }

        return archiveIndexVerifier(sidecar, {
            kdfSalt: meta.archive.kdfSalt,
            noncePrefix: meta.archive.noncePrefix,
        });
    }

    // LEGACY-FORMAT(shared): Whole-file encryption, used by older database backups and by config backups.
    const cipher = streamCipherParams(meta);
    if (!cipher) {
        throw new ValidationError("This backup is not encrypted, so it needs no key.", { field: "file" });
    }

    return legacyHeadVerifier(
        cipher,
        await readHead(adapter, config, file),
        meta.compression as CompressionType | undefined
    );
}

/** IV and auth tag, from either the nested or the flat metadata layout. */
function streamCipherParams(meta: BackupMetadata): { iv: string; authTag: string } | null {
    if (meta.encryption?.enabled && meta.encryption.iv && meta.encryption.authTag) {
        return { iv: meta.encryption.iv, authTag: meta.encryption.authTag };
    }

    const flat = meta as unknown as { iv?: string; authTag?: string };
    if (flat.iv && flat.authTag) return { iv: flat.iv, authTag: flat.authTag };

    return null;
}

/**
 * The backup's leading bytes, by ranged read where the adapter offers one.
 *
 * Without ranges this costs a full download, which is the price of testing a key against a
 * format whose only tell is what its plaintext looks like.
 */
async function readHead(
    adapter: StorageAdapter,
    config: Awaited<ReturnType<typeof resolveAdapterConfig>>,
    file: string
): Promise<Buffer> {
    if (adapter.downloadRange) {
        try {
            const stream = await adapter.downloadRange(config, file, 0, HEAD_PROBE_SIZE - 1);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
            }
            return Buffer.concat(chunks);
        } catch (e: unknown) {
            log.warn("Ranged read failed, falling back to a full download", { file }, wrapError(e));
        }
    }

    const tempFile = path.join(getTempDir(), `key-probe-${process.pid}-${crypto.randomUUID()}`);
    try {
        if (!(await adapter.download(config, file, tempFile))) {
            throw new NotFoundError("Backup file", file);
        }
        const handle = await fs.open(tempFile, "r");
        try {
            const buffer = Buffer.alloc(HEAD_PROBE_SIZE);
            const { bytesRead } = await handle.read(buffer, 0, HEAD_PROBE_SIZE, 0);
            return buffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    } finally {
        await fs.unlink(tempFile).catch(() => { });
    }
}

/** The vault profile already holding these exact key bytes, if there is one. */
async function findProfileWithKey(candidate: Buffer): Promise<{ id: string; name: string } | null> {
    for (const profile of await getEncryptionProfiles()) {
        try {
            if (crypto.timingSafeEqual(await getProfileMasterKey(profile.id), candidate)) {
                return { id: profile.id, name: profile.name };
            }
        } catch { /* an unreadable profile is not a match */ }
    }
    return null;
}

/** Names the profile after the job it was recovered for, so the vault entry explains itself. */
function suggestedProfileName(meta: BackupMetadata, file: string): string {
    const source = meta.jobName || path.basename(file).replace(/\.[^.]+$/, "");
    return `Recovered - ${source}`;
}

/** Appends a counter until the name is free, since profile names must be unique. */
async function uniqueProfileName(base: string): Promise<string> {
    const taken = new Set((await getEncryptionProfiles()).map((p) => p.name));
    if (!taken.has(base)) return base;

    for (let n = 2; ; n++) {
        const candidate = `${base} (${n})`;
        if (!taken.has(candidate)) return candidate;
    }
}
