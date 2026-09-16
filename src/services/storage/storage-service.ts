import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, FileInfo, BackupMetadata } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { resolveDecryptionKey } from "@/services/restore/smart-recovery";
import { writeDatabaseDump } from "@/services/restore/archive-download";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { CompressionType } from "@/lib/crypto/compression";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import AdmZip from "adm-zip";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { EncryptionKeyRequiredError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { isBackupFile, sidecarPathsFor, chainFolderOf, METADATA_SIDECAR_SUFFIX } from "@/lib/core/backup-files";
import { dependentsOf, fileNameOf } from "./bulk-delete-order";

const log = logger.child({ service: "StorageService" });

// Fix: Ensure adapters are registered before service usage
registerAdapters();

import { describeBackupFromMetadata } from "./backup-file-fields";

export { describeBackupFromMetadata } from "./backup-file-fields";

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

/**
 * Schema version of the cached listing payload.
 *
 * The cache stores fully enriched rows, so a release that adds a field to `RichFileInfo`
 * leaves every existing row without it - and reconciliation only enriches *newly seen*
 * files, so those rows would never gain it. Bumping this version discards the payload once
 * on first read after an upgrade and rebuilds it from the sidecars.
 *
 * Bump whenever `enrichSingleFile` starts writing a field the UI depends on.
 * - 1: `combined` and `backupType` (restore scope picker, Type column)
 * - 2: S3 list() now returns paths relative to the adapter's path prefix instead of full
 *      bucket keys, so cached rows keyed by the old full-key path must be discarded. Also
 *      populates compression/encryption from a v2 archive's `archive.*` fields, so rows
 *      cached without them are rebuilt.
 * - 3: the row the runner appends after an upload is now derived by the same code as the
 *      explorer's, so rows it wrote without compression or encryption are rebuilt.
 */
export const CACHE_SCHEMA_VERSION = 3;

interface CachedListing {
    v: number;
    files: RichFileInfo[];
}

/**
 * Reads a cached listing. A bare array is a pre-versioning payload and reports version 0,
 * which every current reader treats as a miss.
 */
function parseCachedListing(json: string): CachedListing {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return { v: 0, files: parsed as RichFileInfo[] };
    return parsed as CachedListing;
}

function serializeCachedListing(files: RichFileInfo[]): string {
    return JSON.stringify({ v: CACHE_SCHEMA_VERSION, files } satisfies CachedListing);
}


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

        const metadata = await this.readLockMetadata(adapter, config, filePath);
        return this.writeLockState(adapterConfigId, adapter, config, filePath, metadata, !metadata.locked);
    }

    /**
     * Sets a backup's lock to an explicit state.
     *
     * Absolute rather than a toggle, because a bulk lock over a mixed selection has to
     * converge on one state instead of flipping each row and staying mixed.
     */
    async setLocked(adapterConfigId: string, filePath: string, locked: boolean): Promise<boolean> {
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: adapterConfigId }
        });

        if (!adapterConfig) throw new Error("Storage not found");

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        const config = await resolveAdapterConfig(adapterConfig);

        return this.setLockedWith(adapterConfigId, adapter, config, filePath, locked);
    }

    /**
     * Lock state change for a caller that already resolved the adapter and its config.
     *
     * A batch resolves both once. Going through `setLocked` per file would repeat a Prisma
     * read and a secret decryption for every row.
     */
    async setLockedWith(
        adapterConfigId: string,
        adapter: StorageAdapter,
        config: unknown,
        filePath: string,
        locked: boolean,
        // A batch updates the cache once at the end instead of rewriting the whole
        // listing blob after every file.
        options: { deferCacheUpdate?: boolean } = {}
    ): Promise<boolean> {
        const metadata = await this.readLockMetadata(adapter, config, filePath);
        if (metadata.locked === locked) return locked;
        return this.writeLockState(adapterConfigId, adapter, config, filePath, metadata, locked, options);
    }

    private async readLockMetadata(adapter: StorageAdapter, config: unknown, filePath: string): Promise<BackupMetadata> {
        const metaPath = filePath + METADATA_SIDECAR_SUFFIX;
        try {
            if (!adapter.read) throw new Error("Adapter does not support reading metadata");
            const content = await adapter.read(config as never, metaPath);
            if (!content) throw new Error("Metadata file not found");
            return JSON.parse(content);
        } catch (e: unknown) {
            log.error("Lock metadata read error", { metaPath }, wrapError(e));
            const message = e instanceof Error ? e.message : "Unknown error";
            throw new Error(`Could not read metadata for this backup: ${message}`);
        }
    }

    private async writeLockState(
        adapterConfigId: string,
        adapter: StorageAdapter,
        config: unknown,
        filePath: string,
        metadata: BackupMetadata,
        locked: boolean,
        options: { deferCacheUpdate?: boolean } = {}
    ): Promise<boolean> {
        const metaPath = filePath + METADATA_SIDECAR_SUFFIX;
        metadata.locked = locked;

        const tempPath = path.join(getTempDir(), `meta-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2));

        try {
            await adapter.upload(config as never, tempPath, metaPath);
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }

        if (!options.deferCacheUpdate) {
            await this.updateStorageListCacheEntry(adapterConfigId, filePath, { locked });
        }

        return locked;
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

    /**
     * Loads the cached listing for mutation, or null when there is nothing usable.
     *
     * An outdated payload is dropped rather than patched: writing an entry back would
     * stamp it with the current version while its other rows stay unenriched.
     */
    private async loadCurrentCache(adapterConfigId: string): Promise<RichFileInfo[] | null> {
        const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId } });
        if (!cached) return null;
        const listing = parseCachedListing(cached.filesJson);
        if (listing.v !== CACHE_SCHEMA_VERSION) {
            await prisma.storageListCache.deleteMany({ where: { adapterConfigId } });
            return null;
        }
        return listing.files;
    }

    /**
     * Applies a change to the cached listing in a single write.
     *
     * The cache is one JSON blob per destination, so every entry-level helper is really a
     * read-modify-write of the whole listing. Routing them all through here lets a batch
     * that touches fifty files pay for one write instead of fifty.
     *
     * `mutate` returns null when nothing changed, which skips the write entirely.
     */
    async mutateStorageListCache(
        adapterConfigId: string,
        mutate: (files: RichFileInfo[]) => RichFileInfo[] | null
    ): Promise<void> {
        const files = await this.loadCurrentCache(adapterConfigId);
        if (!files) return;

        const next = mutate(files);
        if (!next) return;

        await prisma.storageListCache.update({
            where: { adapterConfigId },
            data: { filesJson: serializeCachedListing(next), cachedAt: new Date() },
        });
    }

    async appendStorageListCacheEntry(adapterConfigId: string, entry: RichFileInfo): Promise<void> {
        await this.mutateStorageListCache(adapterConfigId, (files) =>
            files.some(f => f.path === entry.path) ? null : [...files, entry]
        );
    }

    async removeStorageListCacheEntry(adapterConfigId: string, filePath: string): Promise<void> {
        await this.removeStorageListCacheEntries(adapterConfigId, [filePath]);
    }

    /** Drops several entries in one write. */
    async removeStorageListCacheEntries(adapterConfigId: string, filePaths: string[]): Promise<void> {
        if (filePaths.length === 0) return;
        const removing = new Set(filePaths);
        await this.mutateStorageListCache(adapterConfigId, (files) => {
            const filtered = files.filter(f => !removing.has(f.path));
            return filtered.length === files.length ? null : filtered;
        });
    }

    async updateStorageListCacheEntry(adapterConfigId: string, filePath: string, updates: Partial<RichFileInfo>): Promise<void> {
        await this.updateStorageListCacheEntries(adapterConfigId, [filePath], updates);
    }

    /** Applies the same change to several entries in one write. */
    async updateStorageListCacheEntries(adapterConfigId: string, filePaths: string[], updates: Partial<RichFileInfo>): Promise<void> {
        if (filePaths.length === 0) return;
        const updating = new Set(filePaths);
        await this.mutateStorageListCache(adapterConfigId, (files) => {
            let changed = false;
            const next = files.map((file) => {
                if (!updating.has(file.path)) return file;
                changed = true;
                return { ...file, ...updates };
            });
            return changed ? next : null;
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
        if (sidecar) {
            return { ...file, ...describeBackupFromMetadata(file.name, sidecar) };
        }

        // No sidecar: everything below is inferred from the filename and from what the job and
        // execution records happen to say.
        const isEncrypted = file.name.endsWith('.enc');
        const encryptionProfileId: string | undefined = undefined;
        let compression: string | undefined = undefined;
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

        const cachedListing = parseCachedListing(cached.filesJson);
        // Reconciling an outdated payload would only stamp it with the current version
        // while leaving its rows unenriched. Drop it and let the next read rebuild.
        if (cachedListing.v !== CACHE_SCHEMA_VERSION) {
            await prisma.storageListCache.deleteMany({ where: { adapterConfigId } });
            return;
        }
        const cachedFiles = cachedListing.files;
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
            data: { filesJson: serializeCachedListing(updatedFiles), cachedAt: new Date() },
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
                const listing = parseCachedListing(cached.filesJson);
                // A payload from an older release is missing fields the UI reads, and no
                // amount of reconciling brings them back - fall through and rebuild.
                if (listing.v === CACHE_SCHEMA_VERSION) {
                    const ageHours = (Date.now() - cached.cachedAt.getTime()) / 3_600_000;
                    if (ageHours > CACHE_STALENESS_HOURS) {
                        this.reconcileStorageListCache(adapterConfigId).catch(() => {});
                    }
                    return this.applyTypeFilter(listing.files, typeFilter);
                }
                log.info("Discarding outdated storage listing cache", { adapterConfigId, cachedVersion: listing.v });
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
        const jsonStr = serializeCachedListing(results);
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

        // Refuse to gut an incremental chain. Later snapshots reference bytes that live in
        // earlier archives, so deleting one member silently makes every snapshot built on
        // it unrestorable - and the full archive is the largest row in the explorer, which
        // makes it the obvious one to delete for space. Retention already deletes chains
        // whole; manual deletion has to hold the same line.
        const dependents = await this.chainDependentsOf(adapterConfigId, filePath, adapter, config);
        if (dependents.length > 0) {
            throw new Error(
                `This backup is part of an incremental chain that ${dependents.length} later backup(s) still build on: ` +
                `${dependents.slice(0, 3).join(", ")}${dependents.length > 3 ? ", ..." : ""}. ` +
                `Delete the whole chain folder instead, or let retention remove it as a unit.`
            );
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
     * Names the backups that would lose their data if `filePath` were deleted.
     *
     * A chain lives in its own folder, and every member after the one being deleted may
     * carry references into it. Rather than parsing each index, anything in the same chain
     * folder that sorts after this archive is treated as dependent - the folder layout is
     * the chain, and being conservative here costs nothing but a refusal.
     */
    async chainDependentsOf(
        adapterConfigId: string,
        filePath: string,
        adapter: StorageAdapter,
        config: unknown,
        alreadyDeleted: ReadonlySet<string> = new Set()
    ): Promise<string[]> {
        const folder = chainFolderOf(filePath);
        if (!folder) return [];

        try {
            const siblings = await adapter.list(config as never, folder);
            return dependentsOf(siblings.map((f) => f.name), fileNameOf(filePath), alreadyDeleted);
        } catch (e) {
            // Cannot prove it is safe, so do not claim it is.
            log.warn("Could not check chain membership before delete", { adapterConfigId, filePath }, wrapError(e));
            throw new Error("Could not verify whether this backup is part of an incremental chain. Refusing to delete it.");
        }
    }

    /**
     * Reads a backup's `.meta.json`, preferring the adapter's `read()` over a download.
     *
     * @returns The parsed sidecar, or null when there is none or it is unreadable - a
     * backup predating sidecars is still downloadable, so this is never fatal.
     */
    private async readBackupMetaSidecar(
        adapter: StorageAdapter,
        config: unknown,
        remotePath: string
    ): Promise<BackupMetadata | null> {
        const metaRemotePath = remotePath + METADATA_SIDECAR_SUFFIX;

        if (adapter.read) {
            try {
                const content = await adapter.read(config, metaRemotePath);
                if (content) return JSON.parse(content) as BackupMetadata;
            } catch { /* fall through to the download below */ }
        }

        const tempMetaPath = path.join(getTempDir(), "dlmeta_" + Date.now() + ".json");
        try {
            if (!(await adapter.download(config, metaRemotePath, tempMetaPath).catch(() => false))) return null;
            return JSON.parse(await fs.readFile(tempMetaPath, 'utf-8')) as BackupMetadata;
        } catch {
            return null;
        } finally {
            await fs.unlink(tempMetaPath).catch(() => { });
        }
    }

    /**
     * Downloads a file from storage to a local path.
     */
    async downloadFile(
        adapterConfigId: string,
        remotePath: string,
        localDestination: string,
        decrypt: boolean = false,
        options?: { profileIdOverride?: string; rawKeyHex?: string; database?: string }
    ): Promise<{ success: boolean; isZip?: boolean; fileName?: string }> {
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
            // Metadata before bytes: it is what says whether this file has a decrypted form
            // at all, and finding out afterwards would mean having moved a gigabyte for
            // nothing.
            const meta = await this.readBackupMetaSidecar(adapter, config, remotePath);

            // A seekable (v2) archive encrypts each entry on its own, so the archive itself has
            // no decrypted form. What a decrypted download means for it is one database dump,
            // fetched by byte range - the named one, or the only one a single-database job holds.
            if (meta?.archive?.formatVersion === 2) {
                const keyOverride = options?.rawKeyHex || options?.profileIdOverride
                    ? { rawKeyHex: options.rawKeyHex, profileId: options.profileIdOverride }
                    : undefined;
                const { fileName } = await writeDatabaseDump(
                    { storageConfigId: adapterConfigId, file: remotePath, database: options?.database, keyOverride },
                    localDestination
                );
                return { success: true, isZip: false, fileName };
            }

            const success = await adapter.download(config, remotePath, localDestination);
            if (!success) return { success: false };

            try {
                let encryptionParams: { profileId: string, iv: string, authTag: string } | null = null;

                if (meta && meta.encryption && typeof meta.encryption === 'object' && meta.encryption.enabled) {
                    encryptionParams = {
                        profileId: meta.encryption.profileId,
                        iv: meta.encryption.iv,
                        authTag: meta.encryption.authTag
                    };
                } else if (meta && meta.encryptionProfileId && meta.iv && meta.authTag) {
                    // Flat metadata, written before the nested `encryption` object existed.
                    // These keys reach BackupMetadata only through its index signature, so
                    // their shape has to be asserted here.
                    const flat = meta as unknown as { encryptionProfileId: string; iv: string; authTag: string };
                    encryptionParams = {
                        profileId: flat.encryptionProfileId,
                        iv: flat.iv,
                        authTag: flat.authTag
                    };
                }

                if (encryptionParams) {
                    // One resolution path for all three cases - a key the user typed, a
                    // profile they picked, or whatever the vault can offer. A supplied key
                    // is tested here too, so a wrong one is reported as such rather than
                    // producing a file that looks corrupt.
                    const masterKey = await resolveDecryptionKey(
                        {
                            enabled: true as const,
                            profileId: encryptionParams.profileId,
                            algorithm: 'aes-256-gcm' as const,
                            iv: encryptionParams.iv,
                            authTag: encryptionParams.authTag,
                        },
                        localDestination,
                        meta?.compression as CompressionType | undefined,
                        (msg, level) => {
                            if (level === 'error') log.error(msg, {});
                            else if (level === 'warning') log.warn(msg, {});
                            else log.info(msg, {});
                        },
                        { rawKeyHex: options?.rawKeyHex, profileId: options?.profileIdOverride },
                    );

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
                // A missing key is a question for the user, not a decryption failure -
                // relabelling it would hide the one error the UI knows how to answer.
                if (e instanceof EncryptionKeyRequiredError) throw e;
                throw new Error("Decryption failed: " + getErrorMessage(e));
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
