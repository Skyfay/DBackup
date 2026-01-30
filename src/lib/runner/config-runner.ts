// src/lib/runner/config-runner.ts

import { ConfigService } from "@/services/config-service";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable, Transform, pipeline } from "stream";
import { promisify } from "util";
import { createGzip } from "zlib";
import { createEncryptionStream } from "@/lib/crypto-stream";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";

const pipelineAsync = promisify(pipeline);

/**
 * Executes a Configuration Backup.
 */
export async function runConfigBackup() {
    console.log("[ConfigRunner] Starting Configuration Backup...");

    // 1. Fetch Configuration Settings
    const enabled = await prisma.systemSetting.findUnique({ where: { key: "config.backup.enabled" } });
    if (enabled?.value !== "true") {
        console.log("[ConfigRunner] Aborted. Feature disabled.");
        return;
    }

    const storageId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" } });
    const profileId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.profileId" } });
    const includeSecrets = await prisma.systemSetting.findUnique({ where: { key: "config.backup.includeSecrets" } });
    const retentionCountSetting = await prisma.systemSetting.findUnique({ where: { key: "config.backup.retention" } });
    const retentionCount = retentionCountSetting ? parseInt(retentionCountSetting.value) : 10;

    if (!storageId?.value) {
        console.error("[ConfigRunner] No storage destination configured.");
        return;
    }

    // 2. Resolve Storage Adapter
    const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageId.value } });
    if (!storageConfig) {
        throw new Error(`Storage adapter ${storageId.value} not found`);
    }

    const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
    if (!storageAdapter) {
        throw new Error(`Adapter class ${storageConfig.adapterId} not registered`);
    }

    // Decrypt adapter config before instantiation
    let decryptedConfig = {};
    try {
        decryptedConfig = decryptConfig(JSON.parse(storageConfig.config));
    } catch (e) { console.error("Config parse error", e); }


    // 3. Resolve Encryption Key (if profile selected)
    let encryptionKey: Buffer | null = null;
    let ivHex: string | undefined = undefined;
    let authTagHex: string | undefined = undefined;

    if (profileId?.value) {
        const profile = await prisma.encryptionProfile.findUnique({ where: { id: profileId.value } });
        if (profile) {
            // Decrypt the key using system key. Using helper from step-02-dump concept.
            const { decrypt } = await import("@/lib/crypto");

            try {
                const decryptedKeyHex = decrypt(profile.secretKey);
                encryptionKey = Buffer.from(decryptedKeyHex, 'hex');
            } catch (e) {
                console.error("Failed to decrypt profile key", e);
                throw new Error("Failed to unlock encryption profile");
            }

        } else {
             console.warn(`[ConfigRunner] Encryption Profile ${profileId.value} not found.`);
             if (includeSecrets?.value === 'true') {
                 throw new Error("Encryption Profile missing but secrets are included. Aborting backup for security.");
             }
        }
    } else if (includeSecrets?.value === 'true') {
        throw new Error("Cannot include secrets without encryption profile.");
    }

    // 4. Generate JSON Data
    const configService = new ConfigService();
    const safeToIncludeSecrets = (includeSecrets?.value === 'true') && (encryptionKey !== null);
    const backupData = await configService.export(safeToIncludeSecrets);
    const jsonString = JSON.stringify(backupData, null, 2);

    // 5. Create Temp File for Processing
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempDir = os.tmpdir();
    let finalExtension = ".json";

    // Base Stream
    const inputStream: Readable = Readable.from(jsonString);
    const streams: (Readable | Transform | NodeJS.WritableStream)[] = [inputStream];

    // Gzip
    const gzip = createGzip();
    streams.push(gzip);
    finalExtension += ".gz";

    // Encryption
    let getAuthTagFn: (() => Buffer) | null = null;
    if (encryptionKey) {
        const { stream: encryptStream, getAuthTag, iv } = createEncryptionStream(encryptionKey);
        streams.push(encryptStream);
        ivHex = iv.toString('hex');
        getAuthTagFn = getAuthTag;
        finalExtension += ".enc";
    }

    const tempFilePath = path.join(tempDir, `config_backup_${timestamp}${finalExtension}`);
    const fileWriteStream = fs.createWriteStream(tempFilePath);
    streams.push(fileWriteStream);

    console.log(`[ConfigRunner] Streaming config export to ${tempFilePath}...`);

    // Execute Pipeline
    // @ts-expect-error Pipeline types are tricky
    await pipelineAsync(...streams);

    // Get auth tag if encrypted
    if (getAuthTagFn) {
        authTagHex = getAuthTagFn().toString('hex');
    }

    // 6. Calculate Metadata
    const fileStats = await fs.promises.stat(tempFilePath);

    // 7. Upload
    console.log(`[ConfigRunner] Uploading to ${storageConfig.name}...`);
    // Store in a dedicated folder 'system/config' or similar to keep root clean
    // But user asked for folder based on Job name. This is a system task, not a job.
    // Let's use 'config-backups/' as a standard folder.
    const remoteFolder = "config-backups";
    // Usually adapter.upload takes (config, localPath, remotePath).
    // Some adapters (S3) treat remotePath as Key including folder.
    // Others (Local) might expect folder structure to exist or be part of filename.
    const remoteFilename = `${remoteFolder}/config_backup_${timestamp}${finalExtension}`;

    await storageAdapter.upload(decryptedConfig, tempFilePath, remoteFilename);

    // 8. Upload Metadata Sidecar (.meta.json)
    const metadata = {
        version: "1.0",
        originalName: `config_backup_${timestamp}.json`,
        size: fileStats.size,
        compression: "GZIP",
        // Standard Structure
        encryption: encryptionKey ? {
            enabled: true,
            profileId: profileId?.value,
            algorithm: 'aes-256-gcm',
            iv: ivHex,
            authTag: authTagHex
        } : undefined,
        // Legacy fields for backward compat or older services reading this if needed (optional)
        encryptionProfileId: profileId?.value || null,
        sourceType: "SYSTEM",
        createdAt: new Date().toISOString()
    };

    const metaFilenameLocal = path.basename(tempFilePath) + ".meta.json";
    const metaTempPath = path.join(tempDir, metaFilenameLocal);
    const remoteMetaFilename = remoteFilename + ".meta.json";

    await fs.promises.writeFile(metaTempPath, JSON.stringify(metadata, null, 2));

    await storageAdapter.upload(decryptedConfig, metaTempPath, remoteMetaFilename);

    console.log("[ConfigRunner] Backup complete.");

    // 9. Cleanup Temp
    try {
        await fs.promises.unlink(tempFilePath);
        await fs.promises.unlink(metaTempPath);
    } catch(e) { console.warn("Temp cleanup failed", e); }

    // 10. Retention (Simple cleanup of THIS type of files)
    if (retentionCount > 0) {
        await applyConfigRetention(storageAdapter, decryptedConfig, retentionCount);
    }
}

async function applyConfigRetention(adapter: StorageAdapter, config: any, keepParams: number) {
    try {
        console.log("[ConfigRunner] Checking retention policy for config backups...");
        // List in the subfolder
        const files = await adapter.list(config, "config-backups");

        // Filter for our files specifically
        const configFiles = files.filter(f => f.name.includes("config_backup_") && !f.name.endsWith(".meta.json"));

        // Sort by name (which contains timestamp) descending -> Newest first
        configFiles.sort((a, b) => b.name.localeCompare(a.name));

        if (configFiles.length > keepParams) {
             const toDelete = configFiles.slice(keepParams);
             console.log(`[ConfigRunner] Deleting ${toDelete.length} old config backups...`);

             for (const file of toDelete) {
                 try {
                     await adapter.delete(config, file.name);
                 } catch(e) { console.error(`Failed to delete ${file.name}`, e); }

                 // Try delete meta
                 try { await adapter.delete(config, file.name + ".meta.json"); } catch {}
             }
        }
    } catch (e) {
        console.error("Config Retention failed", e);
    }
}
