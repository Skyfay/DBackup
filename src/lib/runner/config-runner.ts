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

    const StorageClass = registry.get(storageConfig.adapterId);
    if (!StorageClass) {
        throw new Error(`Adapter class ${storageConfig.adapterId} not registered`);
    }

    // Decrypt adapter config before instantiation
    let decryptedConfig = {};
    try {
        decryptedConfig = decryptConfig(JSON.parse(storageConfig.config));
    } catch (e) { console.error("Config parse error", e); }

    const storageAdapter = new StorageClass(decryptedConfig) as StorageAdapter;

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
    let inputStream: Readable = Readable.from(jsonString);
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
    // @ts-ignore
    await pipelineAsync(...streams);

    // Get auth tag if encrypted
    if (getAuthTagFn) {
        authTagHex = getAuthTagFn().toString('hex');
    }

    // 6. Calculate Metadata
    const fileStats = await fs.promises.stat(tempFilePath);

    // 7. Upload
    console.log(`[ConfigRunner] Uploading to ${storageConfig.name}...`);
    const fileReadStream = fs.createReadStream(tempFilePath);
    const uploadedPath = await storageAdapter.upload({
        filename: path.basename(tempFilePath),
        stream: fileReadStream,
        size: fileStats.size,
        mimeType: "application/json"
    });

    // 8. Upload Metadata Sidecar (.meta.json)
    const metadata = {
        version: "1.0",
        originalName: `config_backup_${timestamp}.json`,
        size: fileStats.size,
        compression: "GZIP",
        encryption: encryptionKey ? "AES-256-GCM" : "NONE",
        encryptionProfileId: profileId?.value || null,
        iv: ivHex,
        authTag: authTagHex,
        sourceType: "SYSTEM",
        createdAt: new Date().toISOString()
    };

    const metaFilename = path.basename(tempFilePath) + ".meta.json";
    const metaTempPath = path.join(tempDir, metaFilename);
    await fs.promises.writeFile(metaTempPath, JSON.stringify(metadata, null, 2));

    await storageAdapter.upload({
        filename: metaFilename,
        stream: fs.createReadStream(metaTempPath),
        size: (await fs.promises.stat(metaTempPath)).size,
        mimeType: "application/json"
    });

    console.log("[ConfigRunner] Backup complete.");

    // 9. Cleanup Temp
    try {
        await fs.promises.unlink(tempFilePath);
        await fs.promises.unlink(metaTempPath);
    } catch(e) { console.warn("Temp cleanup failed", e); }

    // 10. Retention (Simple cleanup of THIS type of files)
    if (retentionCount > 0) {
        await applyConfigRetention(storageAdapter, retentionCount);
    }
}

async function applyConfigRetention(adapter: StorageAdapter, keepParams: number) {
    try {
        console.log("[ConfigRunner] Checking retention policy for config backups...");
        const files = await adapter.listFiles("config_backup_"); // Prefix filter usually supported or we filter later

        // Filter for our files specifically
        const configFiles = files.filter(f => f.name.includes("config_backup_") && !f.name.endsWith(".meta.json"));

        // Sort by name (which contains timestamp) descending -> Newest first
        configFiles.sort((a, b) => b.name.localeCompare(a.name));

        if (configFiles.length > keepParams) {
             const toDelete = configFiles.slice(keepParams);
             console.log(`[ConfigRunner] Deleting ${toDelete.length} old config backups...`);

             for (const file of toDelete) {
                 try {
                     await adapter.deleteFile(file.name);
                 } catch(e) { console.error(`Failed to delete ${file.name}`, e); }

                 // Try delete meta
                 try { await adapter.deleteFile(file.name + ".meta.json"); } catch {}

                 // Try delete .meta.json if named differently in some old versions? No, standard convention.
             }
        }
    } catch (e) {
        console.error("Config Retention failed", e);
    }
}
