import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, FileInfo, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { getProfileMasterKey } from "@/services/encryption-service";
import { createDecryptionStream } from "@/lib/crypto-stream";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { registerAdapters } from "@/lib/adapters";

// Fix: Ensure adapters are registered before service usage
registerAdapters();

export type RichFileInfo = FileInfo & {
    jobName?: string;
    sourceName?: string;
    sourceType?: string;
    engineVersion?: string;
    dbInfo?: { count: string | number; label: string };
    isEncrypted?: boolean;
    encryptionProfileId?: string;
    locked?: boolean;
};

export class StorageService {
    async toggleLock(adapterConfigId: string, filePath: string) {
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) throw new Error("Storage not found");

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        const config = decryptConfig(JSON.parse(adapterConfig.config));

        // Define paths
        const metaPath = filePath + ".meta.json";

        let metadata: BackupMetadata;

        // 1. Read existing metadata
        try {
            if (!adapter.read) throw new Error("Adapter does not support reading metadata");
            const content = await adapter.read(config, metaPath);
            if (!content) throw new Error("Metadata file not found");
            metadata = JSON.parse(content);
        } catch (e: any) {
             console.error(`Toggle Lock Error: ${e.message}`, { metaPath, error: e });
             throw new Error(`Could not read metadata for this backup: ${e.message}`);
        }

        // 2. Toggle Lock
        metadata.locked = !metadata.locked;

        // 3. Write back
        // StorageAdapter interface usually only has 'upload' (from local file).
        // We need 'write' (string content) or we create a temp file.
        // Let's create a temp file.
        const tempPath = path.join(os.tmpdir(), `meta-${Date.now()}.json`);
        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2));

        try {
             await adapter.upload(config, tempPath, metaPath);
        } finally {
             await fs.unlink(tempPath).catch(() => {});
        }

        return metadata.locked;
    }


    /**
     * Lists files from a specific storage adapter configuration.
     * @param adapterConfigId The ID of the AdapterConfig in the database.
     * @param subPath Optional subpath to list.
     * @param typeFilter Optional filter for source type (e.g. "SYSTEM")
     */
    async listFiles(adapterConfigId: string, subPath: string = "", typeFilter?: string): Promise<FileInfo[]> {
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) {
            throw new Error(`Storage configuration with ID ${adapterConfigId} not found.`);
        }

        if (adapterConfig.type !== "storage") {
            throw new Error(`Adapter configuration ${adapterConfigId} is not a storage adapter.`);
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) {
            throw new Error(`Storage adapter implementation '${adapterConfig.adapterId}' not found in registry.`);
        }

        // Decrypt and parse config
        let config: any;
        try {
            config = decryptConfig(JSON.parse(adapterConfig.config));
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        return await adapter.list(config, subPath);
    }

    /**
     * Lists files and enriches them with metadata from sidecars and database history.
     */
    async listFilesWithMetadata(adapterConfigId: string, typeFilter?: string): Promise<RichFileInfo[]> {
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) {
            throw new Error(`Storage configuration with ID ${adapterConfigId} not found.`);
        }

        if (adapterConfig.type !== "storage") {
            throw new Error(`Adapter configuration ${adapterConfigId} is not a storage adapter.`);
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) {
            throw new Error(`Storage adapter implementation '${adapterConfig.adapterId}' not found in registry.`);
        }

        let config: any;
        try {
            config = decryptConfig(JSON.parse(adapterConfig.config));
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        // TODO: Pass typeFilter to adapter.list if adapters supported optimized filtering.
        // For now, we fetch all and filter in memory.
        const allFiles = await adapter.list(config, "");

        // Filter Backups vs Metadata
        const backups = allFiles.filter(f => !f.name.endsWith('.meta.json'));
        const metadataFiles = allFiles.filter(f => f.name.endsWith('.meta.json'));

        // Load Sidecar Metadata
        const metadataMap = new Map<string, BackupMetadata>();
        if (adapter.read) {
            // Parallel read
            const metaReads = metadataFiles.map(async (metaFile) => {
                try {
                    const content = await adapter.read!(config, metaFile.path);
                    if (content) {
                        const meta = JSON.parse(content) as BackupMetadata;
                        const originalName = metaFile.name.substring(0, metaFile.name.length - 10);
                        metadataMap.set(originalName, meta);
                    }
                } catch {
                    // ignore read errors
                }
            });
            await Promise.all(metaReads);
        }

        // Fetch jobs for fallback logic
        const allJobs = await prisma.job.findMany({
             include: { source: true }
        });

        const jobMap = new Map();
        allJobs.forEach(j => {
             const sanitized = j.name.replace(/[^a-z0-9]/gi, '_');
             jobMap.set(sanitized, j);
             jobMap.set(j.name, j);
        });

        // Fetch executions for metadata
        const executions = await prisma.execution.findMany({
            where: {
                status: 'Success',
                path: { not: null }
            },
            select: {
                path: true,
                metadata: true
            }
        });

        const executionMap = new Map();
        executions.forEach(ex => {
            if (ex.path) {
                executionMap.set(ex.path, ex.metadata);
                if (ex.path.startsWith('/')) {
                     executionMap.set(ex.path.substring(1), ex.metadata);
                }
                if (!ex.path.startsWith('/')) {
                     executionMap.set('/' + ex.path, ex.metadata);
                }
            }
        });

        const results = backups.map(file => {
             // 1. Check Sidecar Metadata (Primary Source of Truth)
             const sidecar = metadataMap.get(file.name);
             let isEncrypted = file.name.endsWith('.enc');
             let encryptionProfileId: string | undefined = undefined;
             let compression: string | undefined = undefined;

             if (sidecar) {
                 // Database Count from Metadata
                 let count = 0;
                 let label = "Unknown";

                 // Handle Config Backups
                 if (sidecar.sourceType === "SYSTEM") {
                     count = 1; // It's one config
                     label = "System Config";
                 } else {
                     count = typeof sidecar.databases === 'object' ? (sidecar.databases as any).count : (typeof sidecar.databases === 'number' ? sidecar.databases : 0);
                     label = count === 0 ? "Unknown" : (count === 1 ? "Single DB" : `${count} DBs`);
                 }


                 if (sidecar.encryption?.enabled) isEncrypted = true;
                 encryptionProfileId = sidecar.encryption?.profileId;
                 compression = sidecar.compression;

                 return {
                     ...file,
                     jobName: sidecar.jobName || (sidecar.sourceType === "SYSTEM" ? "Config Backup" : undefined),
                     sourceName: sidecar.sourceName || (sidecar.sourceType === "SYSTEM" ? "System" : undefined),
                     sourceType: sidecar.sourceType,
                     engineVersion: sidecar.engineVersion,
                     dbInfo: { count, label },
                     isEncrypted,
                     encryptionProfileId,
                     compression,
                     locked: sidecar.locked
                 };
             }

             // Check for compression by extension if not found in sidecar
             if (file.name.endsWith('.gz')) compression = 'GZIP';
             else if (file.name.endsWith('.br')) compression = 'BROTLI';

             // 2. Fallback to Execution History / Regex Logic
             let potentialJobName = null;
             const parts = file.path.split('/');
              if (parts.length > 2 && parts[0] === 'backups') {
                 potentialJobName = parts[1];
             } else if (parts.length > 1 && parts[0] !== 'backups') {
                 potentialJobName = parts[0];
             } else {
                 const match = file.name.match(/^(.+?)_\d{4}-\d{2}-\d{2}/);
                 if (match) potentialJobName = match[1];
             }

             const job = potentialJobName ? jobMap.get(potentialJobName) : null;

             let dbInfo: { count: string | number; label: string } = { count: 'Unknown', label: '' };

             // 1. Try to get metadata from Execution record
             const metaStr = executionMap.get(file.path);
             if (metaStr) {
                 try {
                     const meta = JSON.parse(metaStr);
                     if (meta.label) {
                         dbInfo = { count: meta.count || '?', label: meta.label };
                     }
                     if (meta.jobName) {
                         const realType = meta.adapterId || meta.sourceType;
                         return {
                             ...file,
                             jobName: meta.jobName,
                             sourceName: meta.sourceName,
                             sourceType: realType,
                             dbInfo,
                             isEncrypted,
                             encryptionProfileId,
                             compression
                         }
                     }
                 } catch {}
             }

             // 2. Existing Job Fallback
             if (job) {
                 return {
                     ...file,
                     jobName: job.name,
                     sourceName: job.source.name,
                     sourceType: job.source.type, // e.g. 'database'
                     dbInfo,
                     isEncrypted,
                     encryptionProfileId,
                     compression
                 }
             }

             // 3. Regex Fallback
             return {
                 ...file,
                 jobName: potentialJobName || 'Unknown',
                 sourceName: 'Unknown',
                 sourceType: 'unknown',
                 dbInfo,
                 isEncrypted,
                 encryptionProfileId,
                 compression
             };
        });

        if (typeFilter) {
            if (typeFilter === "SYSTEM") {
                return results.filter(f => (f as any).sourceType === "SYSTEM");
            }
             if (typeFilter === "BACKUP") {
                return results.filter(f => (f as any).sourceType !== "SYSTEM");
            }
        }

        return results;
    }

    /**
     * Deletes a file via a specific storage adapter configuration.
     */
    async deleteFile(adapterConfigId: string, filePath: string): Promise<boolean> {
         const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) {
            throw new Error(`Storage configuration with ID ${adapterConfigId} not found.`);
        }

        if (adapterConfig.type !== "storage") {
             throw new Error(`Adapter configuration ${adapterConfigId} is not a storage adapter.`);
        }

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) {
            throw new Error(`Storage adapter implementation '${adapterConfig.adapterId}' not found in registry.`);
        }

         let config: any;
        try {
            config = decryptConfig(JSON.parse(adapterConfig.config));
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        // Attempt to delete the main file
        const mainDelete = await adapter.delete(config, filePath);

        // Also try to delete potential sidecar files (.meta.json)
        // We don't fail the operation if this fails, but it's good practice to clean up.
        try {
            const metaPath = filePath + ".meta.json";
            await adapter.delete(config, metaPath);
        } catch (e) {
            console.warn(`Failed to delete associated metadata file for ${filePath}`, e);
        }

        return mainDelete;
    }

    /**
     * Downloads a file from storage to a local path.
     */
    async downloadFile(adapterConfigId: string, remotePath: string, localDestination: string, decrypt: boolean = false): Promise<{ success: boolean; isZip?: boolean }> {
        const adapterConfig = await prisma.adapterConfig.findUnique({
           where: { id: adapterConfigId }
       });

       if (!adapterConfig) {
           throw new Error(`Storage configuration with ID ${adapterConfigId} not found.`);
       }

       if (adapterConfig.type !== "storage") {
            throw new Error(`Adapter configuration ${adapterConfigId} is not a storage adapter.`);
       }

       const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
       if (!adapter) {
           throw new Error(`Storage adapter implementation '${adapterConfig.adapterId}' not found in registry.`);
       }

        let config: any;
       try {
           config = decryptConfig(JSON.parse(adapterConfig.config));
       } catch (e) {
           throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
       }

       // 1. Decrypt if requested (Explicit Decryption)
       if (decrypt) {
            // Download basic file first
            const success = await adapter.download(config, remotePath, localDestination);
            if (!success) return { success: false };

            const metaRemotePath = remotePath + ".meta.json";
            const tempMetaPath = path.join(os.tmpdir(), "dlmeta_" + Date.now() + ".json");

            try {
                // Try to get metadata logic
                let meta: any = null;

                // If adapter supports read, use it (faster)
                if (adapter.read) {
                    try {
                        const content = await adapter.read(config, metaRemotePath);
                        if (content) meta = JSON.parse(content);
                    } catch {}
                }

                // Fallback to download if read failed or not supported
                if (!meta) {
                     const metaSuccess = await adapter.download(config, metaRemotePath, tempMetaPath).catch(() => false);
                     if (metaSuccess) {
                         const content = await fs.readFile(tempMetaPath, 'utf-8');
                         meta = JSON.parse(content);
                         await fs.unlink(tempMetaPath).catch(() => {});
                     }
                }

                if (meta && meta.encryption && meta.encryption.enabled) {
                    const masterKey = await getProfileMasterKey(meta.encryption.profileId);
                    const iv = Buffer.from(meta.encryption.iv, 'hex');
                    const authTag = Buffer.from(meta.encryption.authTag, 'hex');

                    const decryptStream = createDecryptionStream(masterKey, iv, authTag);
                    const decryptedPath = localDestination + ".dec";

                    // Decrypt to .dec file
                    await pipeline(
                        createReadStream(localDestination),
                        decryptStream,
                        createWriteStream(decryptedPath)
                    );

                    // Replace Original with Decrypted
                    await fs.unlink(localDestination);
                    await fs.rename(decryptedPath, localDestination);
                }

                return { success: true, isZip: false };
            } catch (e: any) {
                console.error("Decryption during download failed:", e);
                // Return failed state so API returns 500
                throw new Error("Decryption failed: " + e.message);
            }
       }

       // 2. Encrypted File Download (No Decryption) -> Bundle .meta.json if present
       if (remotePath.endsWith('.enc')) {
           const tempDir = path.dirname(localDestination);
           const baseName = path.basename(remotePath);
           const tempMain = path.join(tempDir, `tmp_main_${Date.now()}_${baseName}`);
           const tempMeta = path.join(tempDir, `tmp_meta_${Date.now()}_${baseName}.meta.json`);
           const metaRemotePath = remotePath + ".meta.json";

           try {
               // Download Main File to Temp
               const mainSuccess = await adapter.download(config, remotePath, tempMain);
               if (!mainSuccess) return { success: false };

               // Try Download Meta
               let metaFound = false;
               try {
                   const metaSuccess = await adapter.download(config, metaRemotePath, tempMeta);
                   if (metaSuccess) metaFound = true;
               } catch {}

               if (metaFound) {
                   // Create ZIP
                   try {
                       const zip = new AdmZip();
                       zip.addLocalFile(tempMain, "", baseName);
                       zip.addLocalFile(tempMeta, "", baseName + ".meta.json");
                       zip.writeZip(localDestination);

                       return { success: true, isZip: true };
                   } catch (zipError) {
                       console.error("Zip creation failed:", zipError);
                       // Fallback: Return original file only
                       await fs.rename(tempMain, localDestination);
                       return { success: true, isZip: false };
                   } finally {
                       // Cleanup temps
                       try { await fs.unlink(tempMain); } catch {}
                       try { await fs.unlink(tempMeta); } catch {}
                   }
               } else {
                   // No metadata found, return original file
                   await fs.rename(tempMain, localDestination);
                   return { success: true, isZip: false };
               }
           } catch (e) {
               try { await fs.unlink(tempMain).catch(()=>{}); } catch {}
               try { await fs.unlink(tempMeta).catch(()=>{}); } catch {}
               throw e;
           }
       }

       // 3. Normal File Download
       const success = await adapter.download(config, remotePath, localDestination);
       return { success, isZip: false };
    }
}

export const storageService = new StorageService();
