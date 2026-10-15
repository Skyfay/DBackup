import path from "path";
import fs from "fs";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import type { BackupMetadata, DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getTempDir } from "@/lib/temp-dir";
import type { BrowseEntry } from "@/lib/archive/browse";
import { EncryptionKeyRequiredError, NotFoundError, ServiceError, ValidationError } from "@/lib/logging/errors";
import { archiveIndexService, type ArchiveSummary } from "@/services/backup/archive-index-service";
import type { KeyOverride } from "@/services/backup/key-resolution";
import { findStorageConfig, openStorage } from "./storage-lookup";

registerAdapters();

/**
 * What a backup holds, as the restore and download dialogs list it. A seekable archive answers
 * with its summary, older backups with the names of their databases alone.
 */
export type BackupContents = ArchiveSummary | { databases: string[]; sourceType?: string };

/** One directory level inside a backup, or the directory sources to pick from. */
export interface ArchiveListing {
    sources: ArchiveSummary["directories"];
    entries: BrowseEntry[];
}

/** Source types whose backups restore into a server, which the restore page asks a target for. */
const SERVER_ADAPTERS = ['mysql', 'mariadb', 'postgres', 'mongodb', 'mssql', 'azure-sql', 'redis', 'valkey', 'firebird'];

/** The adapters a downloaded dump is offered to when the caller does not name its type. */
const GUESSED_ADAPTERS = ["mysql", "postgres", "mongodb"];

/**
 * Lists what a backup holds. Reads the sidecar metadata first, so a seekable archive is listed
 * from its index sidecar without a download, and downloads the backup only when that fails or
 * the backup is older than the seekable archive.
 *
 * Throws `NotFoundError` when no storage has this id, and `EncryptionKeyRequiredError` when no
 * key opens the backup.
 */
export async function analyzeBackup(
    storageId: string,
    file: string,
    type: string | undefined,
    keyOverride?: KeyOverride
): Promise<BackupContents> {
    const { adapter, config } = await openStorage(storageId);
    const tempFile = path.join(getTempDir(), path.basename(file));
    try {
        // For combined (manifest v2) archives the metadata sidecar points at the archive's index
        // sidecar, which describes every database and directory source without touching the
        // archive - so a listing never costs a multi-gigabyte download.
        let seekableArchiveMeta: BackupMetadata | null = null;

        if (adapter.read) {
            try {
                const metaContent = await adapter.read(config, file + ".meta.json");
                if (metaContent) {
                    const meta = JSON.parse(metaContent);

                    if ((meta as BackupMetadata).archive?.formatVersion === 2) {
                        seekableArchiveMeta = meta as BackupMetadata;
                        const summary = await archiveIndexService.summarize(storageId, file, seekableArchiveMeta, keyOverride);
                        if (summary) return summary;
                        // Sidecar missing or unreadable. Deliberately NOT falling through to
                        // the legacy shortcuts below - they only understand databases and
                        // would silently drop this archive's directory sources. The embedded
                        // index is read from the downloaded archive instead.
                    }

                    // LEGACY-FORMAT(read): Shortcuts for older backups, which list their databases in the metadata.
                    if (!seekableArchiveMeta && !(meta.combined && meta.combined.directorySources > 0)) {
                        const listed = legacyDatabases(meta);
                        if (listed) return listed;
                    }
                }
            } catch (e: unknown) {
                // A missing key has to escape this catch. It is the one failure here that is
                // answerable, and the fallbacks below cannot help anyway: reading the
                // archive's embedded index needs exactly the key the sidecar already
                // refused. Swallowing it downloaded the whole archive to fail again, then
                // reported the backup as containing nothing.
                if (e instanceof EncryptionKeyRequiredError) throw e;
                // Anything else falls through to the download and the embedded index.
            }
        }

        const downloadSuccess = await adapter.download(config, file, tempFile);
        if (!downloadSuccess) throw new ServiceError("BackupContents", "download", "Download failed");

        // Seekable (v2) archive whose index sidecar could not be read. Every archive also
        // carries a copy of its index as its last member, so the listing still works - it
        // just costs the download that the sidecar exists to avoid.
        if (seekableArchiveMeta) {
            const summary = await archiveIndexService.summarizeFromArchive(tempFile, seekableArchiveMeta, keyOverride);
            if (summary) return summary;
        }

        // LEGACY-FORMAT(read): Analyzing a downloaded file only applies to backups written before the
        // seekable archive.
        return { databases: await analyzeDump(tempFile, type) };
    } finally {
        await fs.promises.unlink(tempFile).catch(() => {});
    }
}

/**
 * LEGACY-FORMAT(read): The databases an older backup lists in its metadata, or null when it lists
 * none and the backup has to be downloaded to find out. The sidecar can come from any older
 * version, so nothing about its shape is taken for granted.
 */
function legacyDatabases(meta: any): BackupContents | null {
    if (meta.databases) {
        if (Array.isArray(meta.databases.names) && meta.databases.names.length > 0) {
            return { databases: meta.databases.names };
        }
        if (Array.isArray(meta.databases) && meta.databases.length > 0) {
            return { databases: meta.databases };
        }
    }
    // For multi-DB TAR archives, return the embedded database list
    if (meta.multiDb?.databases?.length > 0) {
        return { databases: meta.multiDb.databases };
    }
    // For server-based adapters (not sqlite) with empty names,
    // use the source type to signal the frontend that this is a DB restore
    if (meta.sourceType && SERVER_ADAPTERS.includes(meta.sourceType.toLowerCase())) {
        return { databases: [], sourceType: meta.sourceType };
    }
    return null;
}

/**
 * LEGACY-FORMAT(read): Finds the databases in a downloaded dump, through the adapter of its type
 * when the caller names one, otherwise through every adapter that might have written it.
 */
async function analyzeDump(tempFile: string, type: string | undefined): Promise<string[]> {
    if (type) {
        const adapter = registry.get(type) as DatabaseAdapter;
        return adapter && adapter.analyzeDump ? await adapter.analyzeDump(tempFile) : [];
    }
    for (const id of GUESSED_ADAPTERS) {
        const adapter = registry.get(id) as DatabaseAdapter;
        if (adapter && adapter.analyzeDump) {
            const dbs = await adapter.analyzeDump(tempFile);
            if (dbs.length > 0) return dbs;
        }
    }
    return [];
}

/**
 * Lists one directory level inside a backup, reading only the archive's index sidecar. Without a
 * source it lists the directory sources to pick from. Null when the index cannot be read.
 *
 * Throws `NotFoundError` when no storage has this id or the backup has no metadata,
 * `ValidationError` when the storage cannot read metadata or the backup carries no file index,
 * and `EncryptionKeyRequiredError` when no key opens the index.
 */
export async function browseArchive(
    storageId: string,
    file: string,
    options: { jobSourceId?: string; prefix?: string; keyOverride?: KeyOverride }
): Promise<ArchiveListing | null> {
    const row = await findStorageConfig(storageId);
    const adapter = registry.get(row.adapterId) as StorageAdapter | undefined;
    if (!adapter?.read) {
        throw new ValidationError("This storage adapter cannot read backup metadata");
    }

    const config = await resolveAdapterConfig(row);
    const metaContent = await adapter.read(config, `${file}.meta.json`);
    if (!metaContent) throw new NotFoundError("Backup metadata", `${file}.meta.json`);

    const meta = JSON.parse(metaContent) as BackupMetadata;
    if (meta.archive?.formatVersion !== 2) {
        throw new ValidationError("This backup cannot be browsed. Only backups with directory sources created by a recent version carry a file index.");
    }

    const { jobSourceId, prefix, keyOverride } = options;
    // No source selected yet - list the directory sources to pick from.
    if (!jobSourceId) {
        const summary = await archiveIndexService.summarize(storageId, file, meta, keyOverride);
        return summary ? { sources: summary.directories, entries: [] } : null;
    }

    const entries = await archiveIndexService.browse(storageId, file, meta, jobSourceId, prefix, keyOverride);
    return entries ? { sources: [], entries } : null;
}
