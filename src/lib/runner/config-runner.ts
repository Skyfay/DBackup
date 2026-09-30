// src/lib/runner/config-runner.ts

import fs from "fs";
import path from "path";
import { getTempDir } from "@/lib/temp-dir";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { createEncryptionStream } from "@/lib/crypto/stream";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { wrapError, EncryptionError, ConfigurationError } from "@/lib/logging/errors";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { createConfigCopy } from "@/services/config/database-copy";
import packageJson from "../../../package.json";

const log = logger.child({ runner: "ConfigRunner" });

/** What a configuration backup did: the file it wrote and where, or why it did not run. */
export type ConfigBackupResult = { fileName: string; destination: string } | { skipped: string };

/** The folder of the destination the files go into. */
const REMOTE_FOLDER = "config-backups";

/**
 * Executes a Configuration Backup: a copy of the whole database, compressed and encrypted with
 * the key picked for it, since it holds every login. See `src/services/config/database-copy.ts`.
 */
export async function runConfigBackup(): Promise<ConfigBackupResult> {
    log.info("Starting Configuration Backup");

    const settings = new Map(
        (await prisma.systemSetting.findMany({ where: { key: { startsWith: "config.backup." } }, select: { key: true, value: true } }))
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
            createdAt: new Date().toISOString(),
        };
        await fs.promises.writeFile(metaTempPath, JSON.stringify(metadata, null, 2));
        await storageAdapter.upload(decryptedConfig, metaTempPath, `${remoteFilename}.meta.json`);

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
            await applyConfigRetention(storageAdapter, decryptedConfig, retentionCount);
        }

        return { fileName: remoteFilename, destination: storageConfig.name };
    } finally {
        for (const file of [copy.file, tempFilePath, metaTempPath]) {
            await fs.promises.unlink(file).catch(() => undefined);
        }
    }
}

async function applyConfigRetention(adapter: StorageAdapter, config: any, keepParams: number) {
    try {
        log.debug("Checking retention policy for config backups");
        // List in the subfolder
        const files = await adapter.list(config, "config-backups");

        // Filter for our files specifically
        const configFiles = files.filter(f => f.name.includes("config_backup_") && !f.name.endsWith(".meta.json"));

        // Sort by name (which contains timestamp) descending -> Newest first
        configFiles.sort((a, b) => b.name.localeCompare(a.name));

        if (configFiles.length > keepParams) {
             const toDelete = configFiles.slice(keepParams);
             log.info("Deleting old config backups", { count: toDelete.length });

             for (const file of toDelete) {
                 try {
                     await adapter.delete(config, file.name);
                 } catch(e) {
                     log.error("Failed to delete config backup", { fileName: file.name }, wrapError(e));
                 }

                 // Try delete meta
                 try { await adapter.delete(config, file.name + ".meta.json"); } catch {}
             }
        }
    } catch (e) {
        log.error("Config Retention failed", {}, wrapError(e));
    }
}
