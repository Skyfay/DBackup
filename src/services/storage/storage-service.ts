import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, FileInfo, BackupMetadata } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import { resolveDecryptionKey } from "@/services/restore/smart-recovery";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import AdmZip from "adm-zip";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { isBackupFile, sidecarPathsFor, METADATA_SIDECAR_SUFFIX } from "@/lib/core/backup-files";

const log = logger.child({ service: "StorageService" });

// Fix: Ensure adapters are registered before service usage
registerAdapters();

export type RichFileInfo = FileInfo & {
    jobName?: string;
    sourceName?: string;
    sourceType?: string;
    engineVersion?: string;
    engineEdition?: string;
    dbInfo?: { count: string | number; label: string };
    isEncrypted?: boolean;
    encryptionProfileId?: string;
    compression?: string;
    locked?: boolean;
    trigger?: { type: string; actor?: string };
    checksum?: string;
    checksumMd5?: string;
    /** True for seekable (v2) archives, which carry a file index and can be browsed and restored file by file. */
    hasFileIndex?: boolean;
    /** Whether the backup stores everything or only what changed. Set for every backup with metadata. */
    backupType?: 'full' | 'incremental';
    /** What the backup actually contains - drives the restore mode picker. */
    combined?: { databases: number; directorySources: number };
    /** Incremental chain membership. Absent on standalone full backups. */
    chain?: { id: string; type: 'full' | 'incremental'; index: number };
    /**
     * Complete snapshot size. For an incremental this is larger than `size`, which is only
     * what this archive physically stores - the rest lives in earlier archives of the chain.
     */
    logicalSize?: number;
    verification?: {
        verifiedAt: string;
        passed: boolean;
        trigger: 'manual' | 'post-upload' | 'scheduled';
    };
};

// After this many hours a cached listing is considered stale and triggers background reconciliation.
const CACHE_STALENESS_HOURS = 2;

export class StorageService {
    async toggleLock(adapterConfigId: string, filePath: string) {
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) throw new Error("Storage not found");

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        const config = await resolveAdapterConfig(adapterConfig);

        const metaPath = filePath + ".meta.json";

        let metadata: BackupMetadata;

        try {
            if (!adapter.read) throw new Error("Adapter does not support reading metadata");
            const content = await adapter.read(config, metaPath);
            if (!content) throw new Error("Metadata file not found");
            metadata = JSON.parse(content);
        } catch (e: unknown) {
             log.error("Toggle lock error", { metaPath }, wrapError(e));
             const message = e instanceof Error ? e.message : "Unknown error";
             throw new Error(`Could not read metadata for this backup: ${message}`);
        }

        metadata.locked = !metadata.locked;

        const tempPath = path.join(getTempDir(), `meta-${Date.now()}.json`);
        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2));

        try {
             await adapter.upload(config, tempPath, metaPath);
        } finally {
             await fs.unlink(tempPath).catch(() => {});
        }

        await this.updateStorageListCacheEntry(adapterConfigId, filePath, { locked: metadata.locked });

        return metadata.locked;
    }


    /**
     * Lists files from a specific storage adapter configuration.
     */
    async listFiles(adapterConfigId: string, subPath: string = "", _typeFilter?: string): Promise<FileInfo[]> {
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
            config = await resolveAdapterConfig(adapterConfig);
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        return await adapter.list(config, subPath);
    }

    async invalidateStorageListCache(adapterConfigId: string): Promise<void> {
        await prisma.storageListCache.deleteMany({ where: { adapterConfigId } });
    }

    async appendStorageListCacheEntry(adapterConfigId: string, entry: RichFileInfo): Promise<void> {
        const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
        if (!cached) return;
        const files = JSON.parse(cached.filesJson) as RichFileInfo[];
        if (files.some(f => f.path === entry.path)) return;
        files.push(entry);
        await prisma.storageListCache.update({
            where: { adapterConfigId },
            data: { filesJson: JSON.stringify(files), cachedAt: new Date() },
        });
    }

    async removeStorageListCacheEntry(adapterConfigId: string, filePath: string): Promise<void> {
        const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
        if (!cached) return;
        const files = JSON.parse(cached.filesJson) as RichFileInfo[];
        const filtered = files.filter(f => f.path !== filePath);
        if (filtered.length === files.length) return;
        await prisma.storageListCache.update({
            where: { adapterConfigId },
            data: { filesJson: JSON.stringify(filtered), cachedAt: new Date() },
        });
    }

    async updateStorageListCacheEntry(adapterConfigId: string, filePath: string, updates: Partial<RichFileInfo>): Promise<void> {
        const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
        if (!cached) return;
        const files = JSON.parse(cached.filesJson) as RichFileInfo[];
        const idx = files.findIndex(f => f.path === filePath);
        if (idx === -1) return;
        files[idx] = { ...files[idx], ...updates };
        await prisma.storageListCache.update({
            where: { adapterConfigId },
            data: { filesJson: JSON.stringify(files), cachedAt: new Date() },
        });
    }

    private applyTypeFilter(files: RichFileInfo[], typeFilter?: string): RichFileInfo[] {
        if (typeFilter === "SYSTEM")  return files.filter(f => f.sourceType === "SYSTEM");
        if (typeFilter === "BACKUP")  return files.filter(f => f.sourceType !== "SYSTEM");
        return files;
    }

    private enrichSingleFile(
        file: FileInfo,
        metadataMap: Map<string, BackupMetadata>,
        jobMap: Map<string, any>,
        executionMap: Map<string, any>
    ): RichFileInfo {
        const sidecar = metadataMap.get(file.name);
        let isEncrypted = file.name.endsWith('.enc');
        let encryptionProfileId: string | undefined = undefined;
        let compression: string | undefined = undefined;

        if (sidecar) {
            let count = 0;
            let label = "Unknown";
            const isConfigBackup = sidecar.sourceType === "SYSTEM" || file.name.startsWith("config_backup_");

            if (isConfigBackup) {
                count = 1;
                label = "System Config";
            } else {
                count = typeof sidecar.databases === 'object' ? (sidecar.databases as any).count : (typeof sidecar.databases === 'number' ? sidecar.databases : 0);
                if (sidecar.combined) {
                    const { databases: dbCount, directorySources: dirCount } = sidecar.combined;
                    count = dbCount;
                    label = dbCount > 0
                        ? `${dbCount} DB${dbCount === 1 ? '' : 's'} + ${dirCount} Dir${dirCount === 1 ? '' : 's'}`
                        : `${dirCount} Directory Source${dirCount === 1 ? '' : 's'}`;
                } else {
                    label = count === 0 ? "Unknown" : (count === 1 ? "Single DB" : `${count} DBs`);
                }
            }

            if (sidecar.encryption?.enabled) isEncrypted = true;
            encryptionProfileId = sidecar.encryption?.profileId;
            compression = sidecar.compression;

            return {
                ...file,
                jobName: sidecar.jobName || (isConfigBackup ? "Config Backup" : undefined),
                sourceName: sidecar.sourceName || (isConfigBackup ? "System" : undefined),
                sourceType: sidecar.sourceType || (isConfigBackup ? "SYSTEM" : undefined),
                engineVersion: sidecar.engineVersion,
                engineEdition: sidecar.engineEdition,
                dbInfo: { count, label },
                isEncrypted,
                encryptionProfileId,
                compression,
                locked: sidecar.locked,
                trigger: sidecar.trigger as { type: string; actor?: string } | undefined,
                checksum: sidecar.checksum,
                checksumMd5: sidecar.checksumMd5,
                hasFileIndex: sidecar.archive?.formatVersion === 2,
                // Backups written before this field existed are full by construction -
                // incremental mode did not exist yet.
                backupType: sidecar.backupType ?? sidecar.chain?.type ?? 'full',
                ...(sidecar.combined ? { combined: sidecar.combined } : {}),
                ...(sidecar.chain ? { chain: sidecar.chain } : {}),
                ...(typeof sidecar.logicalSize === 'number' ? { logicalSize: sidecar.logicalSize } : {}),
                verification: sidecar.verification ? {
                    verifiedAt: sidecar.verification.verifiedAt,
                    passed: sidecar.verification.passed,
                    trigger: sidecar.verification.trigger,
                } : undefined,
            };
        }

        if (file.name.endsWith('.gz')) compression = 'GZIP';
        else if (file.name.endsWith('.br')) compression = 'BROTLI';

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
                    };
                }
            } catch {}
        }

        if (job) {
            return {
                ...file,
                jobName: job.name,
                sourceName: job.source.name,
                sourceType: job.source.type,
                dbInfo,
                isEncrypted,
                encryptionProfileId,
                compression
            };
        }

        const isConfigBackup = potentialJobName === "config-backups" || potentialJobName === "config_backup" || file.name.startsWith("config_backup_");

        return {
            ...file,
            jobName: isConfigBackup ? "Config Backup" : (potentialJobName || 'Unknown'),
            sourceName: isConfigBackup ? "System" : 'Unknown',
            sourceType: isConfigBackup ? "SYSTEM" : 'unknown',
            dbInfo: isConfigBackup ? { count: 1, label: "System Config" } : dbInfo,
            isEncrypted,
            encryptionProfileId,
            compression
        };
    }

    async reconcileStorageListCache(adapterConfigId: string): Promise<void> {
        const adapterConfig = await prisma.adapterConfig.findUnique({ where: { id: adapterConfigId } });
        if (!adapterConfig || adapterConfig.type !== "storage") return;

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) return;

        let config: any;
        try {
            config = await resolveAdapterConfig(adapterConfig);
        } catch { return; }

        const allRemoteFiles = (await adapter.list(config, "")).filter(f => {
            const p = f.path.replace(/\\/g, '/');
            return !p.startsWith('.dbackup/') && !p.startsWith('/.dbackup/');
        });
        const remoteBackups = allRemoteFiles.filter(f => isBackupFile(f.name));
        const remoteMetaFiles = allRemoteFiles.filter(f => f.name.endsWith(METADATA_SIDECAR_SUFFIX));
        const remotePathSet = new Set(remoteBackups.map(f => f.path));

        const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
        if (!cached) return;

        const cachedFiles = JSON.parse(cached.filesJson) as RichFileInfo[];
        const cachedPathSet = new Set(cachedFiles.map(f => f.path));

        const removedPaths = new Set([...cachedPathSet].filter(p => !remotePathSet.has(p)));
        const newFiles = remoteBackups.filter(f => !cachedPathSet.has(f.path));

        if (removedPaths.size === 0 && newFiles.length === 0) {
            await prisma.storageListCache.update({
                where: { adapterConfigId },
                data: { cachedAt: new Date() },
            });
            return;
        }

        let updatedFiles = cachedFiles.filter(f => !removedPaths.has(f.path));

        if (newFiles.length > 0) {
            const metadataMap = new Map<string, BackupMetadata>();
            if (adapter.read) {
                const newFileNames = new Set(newFiles.map(f => f.name));
                const relevantMetaFiles = remoteMetaFiles.filter(mf => newFileNames.has(mf.name.slice(0, -10)));
                await Promise.all(relevantMetaFiles.map(async (metaFile) => {
                    try {
                        const content = await adapter.read!(config, metaFile.path);
                        if (content) metadataMap.set(metaFile.name.slice(0, -10), JSON.parse(content) as BackupMetadata);
                    } catch { /* ignore */ }
                }));
            }

            const allJobs = await prisma.job.findMany({ include: { source: true } });
            const jobMap = new Map();
            allJobs.forEach(j => {
                jobMap.set(j.name.replace(/[^a-z0-9]/gi, '_'), j);
                jobMap.set(j.name, j);
            });

            const executions = await prisma.execution.findMany({
                where: { status: 'Success', path: { not: null } },
                select: { path: true, metadata: true }
            });
            const executionMap = new Map();
            executions.forEach(ex => {
                if (ex.path) {
                    executionMap.set(ex.path, ex.metadata);
                    if (ex.path.startsWith('/')) executionMap.set(ex.path.substring(1), ex.metadata);
                    else executionMap.set('/' + ex.path, ex.metadata);
                }
            });

            const enrichedNew = newFiles.map(f => this.enrichSingleFile(f, metadataMap, jobMap, executionMap));
            updatedFiles = [...updatedFiles, ...enrichedNew];
        }

        await prisma.storageListCache.update({
            where: { adapterConfigId },
            data: { filesJson: JSON.stringify(updatedFiles), cachedAt: new Date() },
        });
        log.debug("Reconciled storage cache", { adapterConfigId, removed: removedPaths.size, added: newFiles.length });
    }

    /**
     * Lists files and enriches them with metadata from sidecars and database history.
     * Results are cached in SQLite; pass bypassCache=true to force a live re-fetch.
     * Stale caches (> CACHE_STALENESS_HOURS) trigger a background reconciliation.
     */
    async listFilesWithMetadata(adapterConfigId: string, typeFilter?: string, bypassCache = false): Promise<RichFileInfo[]> {
        if (!bypassCache) {
            const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
            if (cached) {
                const ageHours = (Date.now() - cached.cachedAt.getTime()) / 3_600_000;
                if (ageHours > CACHE_STALENESS_HOURS) {
                    this.reconcileStorageListCache(adapterConfigId).catch(() => {});
                }
                return this.applyTypeFilter(JSON.parse(cached.filesJson) as RichFileInfo[], typeFilter);
            }
        }

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
            config = await resolveAdapterConfig(adapterConfig);
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        const allFiles = (await adapter.list(config, "")).filter(f => {
            const p = f.path.replace(/\\/g, '/');
            return !p.startsWith('.dbackup/') && !p.startsWith('/.dbackup/');
        });

        const backups = allFiles.filter(f => isBackupFile(f.name));
        const metadataFiles = allFiles.filter(f => f.name.endsWith(METADATA_SIDECAR_SUFFIX));

        const metadataMap = new Map<string, BackupMetadata>();
        if (adapter.read) {
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

        const allJobs = await prisma.job.findMany({
             include: { source: true }
        });

        const jobMap = new Map();
        allJobs.forEach(j => {
             const sanitized = j.name.replace(/[^a-z0-9]/gi, '_');
             jobMap.set(sanitized, j);
             jobMap.set(j.name, j);
        });

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

        const results = backups.map(file => this.enrichSingleFile(file, metadataMap, jobMap, executionMap));

        // Persist to cache (full list without typeFilter applied)
        const jsonStr = JSON.stringify(results);
        prisma.storageListCache.upsert({
            where:  { adapterConfigId },
            create: { adapterConfigId, filesJson: jsonStr },
            update: { filesJson: jsonStr, cachedAt: new Date() },
        }).catch(() => {});

        return this.applyTypeFilter(results, typeFilter);
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
            config = await resolveAdapterConfig(adapterConfig);
        } catch (e) {
            throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
        }

        const mainDelete = await adapter.delete(config, filePath);

        // Every sidecar goes with it, otherwise orphans accumulate and later confuse
        // listings and storage statistics.
        for (const sidecar of sidecarPathsFor(filePath)) {
            try {
                await adapter.delete(config, sidecar);
            } catch (e) {
                log.warn("Failed to delete associated sidecar file", { filePath, sidecar }, wrapError(e));
            }
        }

        await this.removeStorageListCacheEntry(adapterConfigId, filePath);

        return mainDelete;
    }

    /**
     * Downloads a file from storage to a local path.
     */
    async downloadFile(adapterConfigId: string, remotePath: string, localDestination: string, decrypt: boolean = false, options?: { profileIdOverride?: string; rawKeyHex?: string }): Promise<{ success: boolean; isZip?: boolean }> {
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
           config = await resolveAdapterConfig(adapterConfig);
       } catch (e) {
           throw new Error(`Failed to decrypt configuration for ${adapterConfigId}: ${(e as Error).message}`);
       }

       if (decrypt) {
            const success = await adapter.download(config, remotePath, localDestination);
            if (!success) return { success: false };

            const metaRemotePath = remotePath + ".meta.json";
            const tempMetaPath = path.join(getTempDir(), "dlmeta_" + Date.now() + ".json");

            try {
                let meta: any = null;

                if (adapter.read) {
                    try {
                        const content = await adapter.read(config, metaRemotePath);
                        if (content) meta = JSON.parse(content);
                    } catch {}
                }

                if (!meta) {
                     const metaSuccess = await adapter.download(config, metaRemotePath, tempMetaPath).catch(() => false);
                     if (metaSuccess) {
                         const content = await fs.readFile(tempMetaPath, 'utf-8');
                         meta = JSON.parse(content);
                         await fs.unlink(tempMetaPath).catch(() => {});
                     }
                }

                let encryptionParams: { profileId: string, iv: string, authTag: string } | null = null;

                if (meta && meta.encryption && typeof meta.encryption === 'object' && meta.encryption.enabled) {
                    encryptionParams = {
                        profileId: meta.encryption.profileId,
                        iv: meta.encryption.iv,
                        authTag: meta.encryption.authTag
                    };
                } else if (meta && meta.encryptionProfileId && meta.iv && meta.authTag) {
                     encryptionParams = {
                        profileId: meta.encryptionProfileId,
                        iv: meta.iv,
                        authTag: meta.authTag
                    };
                }

                if (encryptionParams) {
                    let masterKey: Buffer;

                    if (options?.rawKeyHex) {
                        masterKey = Buffer.from(options.rawKeyHex, 'hex');
                    } else if (options?.profileIdOverride) {
                        masterKey = await getProfileMasterKey(options.profileIdOverride);
                    } else {
                        const encryptionMeta = {
                            enabled: true as const,
                            profileId: encryptionParams.profileId,
                            algorithm: 'aes-256-gcm' as const,
                            iv: encryptionParams.iv,
                            authTag: encryptionParams.authTag,
                        };
                        const compression = meta?.compression as 'GZIP' | 'BROTLI' | 'NONE' | undefined;
                        try {
                            masterKey = await resolveDecryptionKey(
                                encryptionMeta,
                                localDestination,
                                compression,
                                (msg, level) => {
                                    if (level === 'error') log.error(msg, {});
                                    else if (level === 'warning') log.warn(msg, {});
                                    else log.info(msg, {});
                                },
                            );
                        } catch {
                            throw new Error(`ENCRYPTION_KEY_REQUIRED:${encryptionParams.profileId}`);
                        }
                    }

                    const iv = Buffer.from(encryptionParams.iv, 'hex');
                    const authTag = Buffer.from(encryptionParams.authTag, 'hex');

                    const decryptStream = createDecryptionStream(masterKey, iv, authTag);
                    const decryptedPath = localDestination + ".dec";

                    await pipeline(
                        createReadStream(localDestination),
                        decryptStream,
                        createWriteStream(decryptedPath)
                    );

                    await fs.unlink(localDestination);
                    await fs.rename(decryptedPath, localDestination);
                }

                return { success: true, isZip: false };
            } catch (e: unknown) {
                if (e instanceof Error && e.message.startsWith("ENCRYPTION_KEY_REQUIRED:")) {
                    throw e;
                }
                const message = e instanceof Error ? e.message : String(e);
                throw new Error("Decryption failed: " + message);
            }
       }

       if (remotePath.endsWith('.enc')) {
           const tempDir = path.dirname(localDestination);
           const baseName = path.basename(remotePath);
           const tempMain = path.join(tempDir, `tmp_main_${Date.now()}_${baseName}`);
           const tempMeta = path.join(tempDir, `tmp_meta_${Date.now()}_${baseName}.meta.json`);
           const metaRemotePath = remotePath + ".meta.json";

           try {
               const mainSuccess = await adapter.download(config, remotePath, tempMain);
               if (!mainSuccess) return { success: false };

               let metaFound = false;
               try {
                   const metaSuccess = await adapter.download(config, metaRemotePath, tempMeta);
                   if (metaSuccess) metaFound = true;
               } catch {}

               if (metaFound) {
                   try {
                       const zip = new AdmZip();
                       zip.addLocalFile(tempMain, "", baseName);
                       zip.addLocalFile(tempMeta, "", baseName + ".meta.json");
                       zip.writeZip(localDestination);

                       return { success: true, isZip: true };
                   } catch (zipError) {
                       log.error("Zip creation failed", { remotePath }, wrapError(zipError));
                       await fs.rename(tempMain, localDestination);
                       return { success: true, isZip: false };
                   } finally {
                       try { await fs.unlink(tempMain); } catch {}
                       try { await fs.unlink(tempMeta); } catch {}
                   }
               } else {
                   await fs.rename(tempMain, localDestination);
                   return { success: true, isZip: false };
               }
           } catch (e) {
               try { await fs.unlink(tempMain).catch(()=>{}); } catch {}
               try { await fs.unlink(tempMeta).catch(()=>{}); } catch {}
               throw e;
           }
       }

       const success = await adapter.download(config, remotePath, localDestination);
       return { success, isZip: false };
    }
}

export const storageService = new StorageService();
