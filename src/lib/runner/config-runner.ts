// src/lib/runner/config-runner.ts

import fs from "fs";
import path from "path";
import { getTempDir } from "@/lib/temp-dir";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { createEncryptionStream } from "@/lib/crypto/stream";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import type { BackupMetadata, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { wrapError, EncryptionError, ConfigurationError } from "@/lib/logging/errors";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { createConfigCopy } from "@/services/config/database-copy";
import { describeBackupFromMetadata } from "@/services/storage/backup-file-fields";
import packageJson from "../../../package.json";

const log = logger.child({ runner: "ConfigRunner" });

/** What a configuration backup did: the file it wrote and where, or why it did not run. */
export type ConfigBackupResult = { fileName: string; destination: string } | { skipped: string };

/** The folder of the destination the files go into. */
const REMOTE_FOLDER = "config-backups";

const CONFIG_KEYS = ["config.backup.enabled", "config.backup.storageId", "config.backup.profileId", "config.backup.includeStatistics", "config.backup.retention"];
/** Whether the metadata of a backup names who started it, under Settings, Privacy. */
const ACTOR_SETTING = "privacy.includeActorInMetadata";

/** Who started a configuration backup: its schedule, someone with Back up now, or an API key. */
export interface ConfigBackupTrigger {
    type: "Manual" | "Scheduler" | "Api";
    /** The person or the API key, named in the metadata unless Privacy leaves it out. */
    label?: string;
}

/**
 * Executes a Configuration Backup: a copy of the whole database, compressed and encrypted with
 * the key picked for it, since it holds every login. See `src/services/config/database-copy.ts`.
 */
export async function runConfigBackup(trigger: ConfigBackupTrigger = { type: "Scheduler", label: "Scheduler" }): Promise<ConfigBackupResult> {
    log.info("Starting Configuration Backup");

    const settings = new Map(
        (await prisma.systemSetting.findMany({ where: { key: { in: [...CONFIG_KEYS, ACTOR_SETTING] } }, select: { key: true, value: true } }))
            .map((row) => [row.key, row.value])
    );
    if (settings.get("config.backup.enabled") !== "true") {
        log.info("Aborted - feature disabled");
        return { skipped: "Off under Configuration backup" };
    }
    const storageId = settings.get("config.backup.storageId");
    const profileId = settings.get("config.backup.profileId");
    const includeHistory = settings.get("config.backup.includeStatistics") === "true";
    const retentionCount = settings.has("config.backup.retention") ? parseInt(settings.get("config.backup.retention") ?? "", 10) : 10;

    if (!storageId) {
        throw new ConfigurationError("config-backup", "No destination is picked under Configuration backup");
    }
    if (!profileId) {
        throw new ConfigurationError("config-backup", "No encryption key is picked under Configuration backup. The file holds every login, so it is always encrypted");
    }

    // 1. The destination
    const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageId } });
    if (!storageConfig) {
        throw new ConfigurationError("config-backup", `Storage adapter ${storageId} not found`);
    }
    const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
    if (!storageAdapter) {
        throw new ConfigurationError("config-backup", `Adapter class ${storageConfig.adapterId} not registered`);
    }
    // Resolve adapter config (merges referenced credential profile if present)
    let decryptedConfig = {};
    try {
        decryptedConfig = await resolveAdapterConfig(storageConfig) as Record<string, unknown>;
    } catch (e) {
        log.error("Config parse error", {}, wrapError(e));
    }

    // 2. The key
    const profile = await prisma.encryptionProfile.findUnique({ where: { id: profileId } });
    if (!profile) {
        throw new ConfigurationError("config-backup", "The encryption key picked under Configuration backup no longer exists");
    }
    let encryptionKey: Buffer;
    try {
        const { decrypt } = await import("@/lib/crypto");
        encryptionKey = Buffer.from(decrypt(profile.secretKey), "hex");
    } catch (e) {
        log.error("Failed to decrypt profile key", {}, wrapError(e));
        throw new EncryptionError("decrypt", "Failed to unlock encryption profile");
    }

    // 3. The copy, compressed and encrypted
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `config_backup_${timestamp}.db`;
    const tempFilePath = path.join(getTempDir(), `${baseName}.gz.enc`);
    const metaTempPath = `${tempFilePath}.meta.json`;
    const copy = await createConfigCopy({ includeHistory });
    try {
        const { stream: encryptStream, getAuthTag, iv } = createEncryptionStream(encryptionKey);
        log.debug("Streaming the database copy to a temp file", { tempFilePath });
        await pipeline(fs.createReadStream(copy.file), createGzip(), encryptStream, fs.createWriteStream(tempFilePath));
        const fileStats = await fs.promises.stat(tempFilePath);

        // 4. Upload, with its metadata beside it
        log.info("Uploading config backup to storage", { storageName: storageConfig.name });
        const remoteFilename = `${REMOTE_FOLDER}/${baseName}.gz.enc`;
        await storageAdapter.upload(decryptedConfig, tempFilePath, remoteFilename);

        // Like the metadata of a job: who started it, named unless Privacy leaves the name out.
        const includeActor = settings.has(ACTOR_SETTING) ? settings.get(ACTOR_SETTING) === "true" : true;
        const createdAt = new Date().toISOString();
        const metadata = {
            version: "2.0",
            // A copy of the whole database, which a restore tells from a file of an older version.
            kind: "database",
            appVersion: packageJson.version,
            originalName: baseName,
            size: fileStats.size,
            compression: "GZIP",
            encryption: {
                enabled: true,
                profileId,
                algorithm: "aes-256-gcm",
                iv: iv.toString("hex"),
                authTag: getAuthTag().toString("hex"),
            },
            encryptionProfileId: profileId,
            sourceType: "SYSTEM",
            createdAt,
            // The time the Backups page shows, under the name the metadata of a job has for it.
            timestamp: createdAt,
            trigger: { type: trigger.type, ...(includeActor && trigger.label ? { actor: trigger.label } : {}) },
        };
        await fs.promises.writeFile(metaTempPath, JSON.stringify(metadata, null, 2));
        await storageAdapter.upload(decryptedConfig, metaTempPath, `${remoteFilename}.meta.json`);

        // The Backups page lists it at once, like a backup of a job, instead of after its next scan.
        try {
            const { storageService } = await import("@/services/storage/storage-service");
            const name = path.basename(remoteFilename);
            await storageService.appendStorageListCacheEntry(storageId, {
                name,
                path: remoteFilename,
                size: fileStats.size,
                lastModified: new Date(),
                ...describeBackupFromMetadata(name, metadata as unknown as BackupMetadata),
            });
        } catch (error: unknown) {
            // A stale listing is cosmetic, it never fails a backup that is stored.
            log.warn("Could not add the config backup to the storage listing", {}, wrapError(error));
        }

        log.info("Configuration Backup complete");

        // System notification (fire-and-forget)
        notify({
            eventType: NOTIFICATION_EVENTS.CONFIG_BACKUP,
            data: {
                fileName: remoteFilename,
                encrypted: true,
                timestamp: new Date().toISOString(),
            },
        }).catch(() => {});

        // 5. Retention (Simple cleanup of THIS type of files)
        if (retentionCount > 0) {
            await applyConfigRetention(storageAdapter, decryptedConfig, retentionCount, storageId);
        }

        return { fileName: remoteFilename, destination: storageConfig.name };
    } finally {
        for (const file of [copy.file, tempFilePath, metaTempPath]) {
            await fs.promises.unlink(file).catch(() => undefined);
        }
    }
}

/**
 * Keeps the newest config backups and deletes the rest with their metadata. A file is deleted by
 * its path from the listing, which holds the folder, and leaves the listing of the Backups page too.
 */
async function applyConfigRetention(adapter: StorageAdapter, config: any, keepParams: number, storageId: string) {
    try {
        log.debug("Checking retention policy for config backups");
        const files = await adapter.list(config, REMOTE_FOLDER);

        // Filter for our files specifically
        const configFiles = files.filter(f => f.name.includes("config_backup_") && !f.name.endsWith(".meta.json"));

        // Sort by name (which contains timestamp) descending -> Newest first
        configFiles.sort((a, b) => b.name.localeCompare(a.name));

        if (configFiles.length > keepParams) {
             const toDelete = configFiles.slice(keepParams);
             log.info("Deleting old config backups", { count: toDelete.length });
             const deleted: string[] = [];

             for (const file of toDelete) {
                 try {
                     await adapter.delete(config, file.path);
                     deleted.push(file.path);
                 } catch(e) {
                     log.error("Failed to delete config backup", { fileName: file.name }, wrapError(e));
                     continue;
                 }

                 try { await adapter.delete(config, `${file.path}.meta.json`); } catch {}
             }

             if (deleted.length > 0) {
                 const { storageService } = await import("@/services/storage/storage-service");
                 await storageService.removeStorageListCacheEntries(storageId, deleted).catch((error: unknown) =>
                     log.warn("Could not remove deleted config backups from the storage listing", {}, wrapError(error)));
             }
        }
    } catch (e) {
        log.error("Config Retention failed", {}, wrapError(e));
    }
}
