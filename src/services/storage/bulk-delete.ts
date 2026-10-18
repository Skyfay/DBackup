/**
 * Deleting and locking several backups in one request.
 *
 * Kept out of `storage-service.ts` for two reasons: that file is already large, and a
 * batch needs a different shape from a single operation. `deleteFile` resolves the
 * adapter, decrypts the destination's secrets, lists the chain folder and rewrites the
 * whole listing cache - all per file. Repeating that fifty times is fifty decryptions and
 * fifty cache writes to reach one outcome.
 */

import { StorageAdapter } from "@/lib/core/interfaces";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { sidecarPathsFor, chainFolderOf } from "@/lib/core/backup-files";
import { emptyBulkResult, type BulkResult } from "@/lib/core/bulk";
import { storageService, type RichFileInfo } from "./storage-service";
import { orderPathsForDelete, dependentsOf, fileNameOf } from "./bulk-delete-order";
import { openDestination } from "@/services/sharing/destination-access";
import { assertFilePath } from "@/lib/tenant/storage-view";

const log = logger.child({ service: "StorageBulkDelete" });

interface ResolvedDestination {
    adapter: StorageAdapter;
    config: unknown;
}

/** Resolves the adapter and its decrypted config once for the whole batch. */
async function resolveDestination(adapterConfigId: string): Promise<ResolvedDestination> {
    const { adapter, config } = await openDestination(adapterConfigId);
    return { adapter, config };
}

/** Indexes the destination's listing by path, for the lock check. */
async function listingByPath(adapterConfigId: string): Promise<Map<string, RichFileInfo>> {
    try {
        const files = await storageService.listFilesWithMetadata(adapterConfigId);
        return new Map(files.map((file) => [file.path, file]));
    } catch (e) {
        // Without a listing the lock state is unknown, and guessing "unlocked" would
        // delete a backup somebody deliberately protected.
        log.error("Could not list destination before bulk delete", { adapterConfigId }, wrapError(e));
        throw new Error("Could not read this destination's contents. Nothing was deleted.");
    }
}

/**
 * Deletes several backups, reporting per-file outcomes.
 *
 * Locked backups are refused, and incremental chains are deleted newest-first so that a
 * whole chain can go while a partial selection is still correctly refused.
 */
export async function deleteBackupsBulk(adapterConfigId: string, filePaths: string[]): Promise<BulkResult> {
    if (filePaths.length === 0) return emptyBulkResult();

    const { adapter, config } = await resolveDestination(adapterConfigId);
    const listing = await listingByPath(adapterConfigId);

    const result = emptyBulkResult();
    const deleted: string[] = [];
    // Filenames removed so far, per chain folder. The dependency check consults this so a
    // member is not refused for depending on one this same batch already removed.
    const removedByFolder = new Map<string, Set<string>>();
    // One listing per chain folder rather than one per file.
    const siblingsByFolder = new Map<string, string[]>();

    for (const filePath of orderPathsForDelete(filePaths)) {
        const name = () => listing.get(filePath)?.name ?? fileNameOf(filePath);

        try {
            // A storage like WebDAV deletes a folder with everything in it, so the root never goes.
            assertFilePath(filePath);
            if (listing.get(filePath)?.locked) {
                throw new Error("This backup is locked. Unlock it before deleting.");
            }

            const folder = chainFolderOf(filePath);
            if (folder) {
                if (!siblingsByFolder.has(folder)) {
                    const siblings = await adapter.list(config as never, folder);
                    siblingsByFolder.set(folder, siblings.map((f) => f.name));
                }
                const removed = removedByFolder.get(folder) ?? new Set<string>();
                const blockers = dependentsOf(siblingsByFolder.get(folder) ?? [], fileNameOf(filePath), removed);
                if (blockers.length > 0) {
                    throw new Error(
                        `This backup is part of an incremental chain that ${blockers.length} later backup(s) still build on: ` +
                        `${blockers.slice(0, 3).join(", ")}${blockers.length > 3 ? ", ..." : ""}. ` +
                        `Select the whole chain, or let retention remove it as a unit.`
                    );
                }
            }

            const removedMain = await adapter.delete(config as never, filePath);
            if (!removedMain) throw new Error("The storage provider did not delete this file.");

            for (const sidecar of sidecarPathsFor(filePath)) {
                try {
                    await adapter.delete(config as never, sidecar);
                } catch (e) {
                    log.warn("Failed to delete associated sidecar file", { filePath, sidecar }, wrapError(e));
                }
            }

            if (folder) {
                const removed = removedByFolder.get(folder) ?? new Set<string>();
                removed.add(fileNameOf(filePath));
                removedByFolder.set(folder, removed);
            }

            deleted.push(filePath);
            result.succeeded.push(filePath);
        } catch (e: unknown) {
            result.failed.push({ id: filePath, name: name(), error: getErrorMessage(e) });
        }
    }

    // One cache write for the batch rather than one per file.
    await storageService.removeStorageListCacheEntries(adapterConfigId, deleted);

    return result;
}

/**
 * Locks or unlocks several backups.
 *
 * Absolute rather than a toggle, so a mixed selection converges instead of inverting.
 */
export async function setBackupsLocked(
    adapterConfigId: string,
    filePaths: string[],
    locked: boolean
): Promise<BulkResult> {
    if (filePaths.length === 0) return emptyBulkResult();

    const { adapter, config } = await resolveDestination(adapterConfigId);
    const result = emptyBulkResult();

    // The sidecar rewrite is unavoidably one remote write per file, but the adapter and
    // its decrypted config are resolved once above and the cache is written once below.
    for (const filePath of filePaths) {
        try {
            await storageService.setLockedWith(adapterConfigId, adapter, config, filePath, locked, {
                deferCacheUpdate: true,
            });
            result.succeeded.push(filePath);
        } catch (e: unknown) {
            result.failed.push({ id: filePath, name: fileNameOf(filePath), error: getErrorMessage(e) });
        }
    }

    await storageService.updateStorageListCacheEntries(adapterConfigId, result.succeeded, { locked });

    return result;
}
