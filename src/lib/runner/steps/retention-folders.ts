import path from "path";
import type { AdapterConfig, FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { isBackupFile } from "@/lib/core/backup-files";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import type { RichFileInfo } from "@/services/storage/storage-service";
import { loadBackupSidecars, type SidecarLoadResult } from "./retention-sidecars";

/**
 * The backups a renamed job left in the folder of its old name.
 *
 * A job writes into a folder named after it, so a rename starts a new folder and leaves the
 * backups made so far in the old one, where the retention of the job would never look again.
 * Retention follows the job there, so its policy keeps covering every backup the job made, the
 * way the Storage Explorer and the retention preview of its timeline already count them.
 *
 * The cached listing of the destination knows which job made each backup, so finding those
 * folders costs no storage call. Each one is then listed and its sidecars read like the current
 * folder, but only as long as the cache still knows backups of the job there. In a former folder
 * only a backup whose sidecar names the job counts, since the folder may belong to another job
 * by now, or hold files copied there by hand.
 */

const log = logger.child({ step: "05-retention" });

/** A folder the way retention compares them: forward slashes and no slash at either end. */
export function folderKey(dir: string): string {
    return dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** The folders other than the current one where the cached listing knows backups of the job. */
export async function formerFoldersOf(configId: string, jobId: string, currentDir: string): Promise<string[]> {
    let cached: { files: RichFileInfo[] } | null;
    try {
        // Loaded when needed, like everywhere in the runner.
        const { storageService } = await import("@/services/storage/storage-service");
        cached = await storageService.readCachedListing(configId);
    } catch (error: unknown) {
        // Without the cache the run looks at the current folder only, like before a rename.
        log.warn("Could not read the cached listing to find the former folders of a job", { configId, jobId }, wrapError(error));
        return [];
    }
    if (!cached) return [];

    const current = folderKey(currentDir);
    const folders = new Set<string>();
    for (const file of cached.files) {
        if (file.jobId !== jobId) continue;
        const dir = path.posix.dirname(folderKey(file.path));
        // The backups of an incremental chain sit in a folder of their own inside the folder of the job.
        const folder = folderKey(file.chain ? path.posix.dirname(dir) : dir);
        // Never the root of the destination, whose listing would hold everything on it.
        if (folder === "" || folder === "." || folder === current) continue;
        folders.add(folder);
    }
    return [...folders].sort();
}

export interface FormerBackups {
    /** The backups of the job in its former folders, with their sidecars read. */
    files: FileInfo[];
    /** Those of them whose recorded creation time and mtime disagree. */
    drifted: SidecarLoadResult["drifted"];
    /** How many backups of the job each former folder holds, for the run log. */
    folders: { folder: string; count: number }[];
}

/**
 * Lists every former folder of the job and returns the backups there whose sidecar names it.
 * A folder that cannot be listed right now is left for the next run.
 *
 * @param seen Paths already in the listing of the current folder, which are never taken twice.
 */
export async function loadFormerBackups(
    adapter: StorageAdapter,
    config: AdapterConfig,
    configId: string,
    jobId: string,
    currentDir: string,
    seen: Set<string>
): Promise<FormerBackups> {
    const result: FormerBackups = { files: [], drifted: [], folders: [] };
    if (!adapter.list) return result;

    for (const folder of await formerFoldersOf(configId, jobId, currentDir)) {
        let listing: FileInfo[];
        try {
            listing = await adapter.list(config, folder);
        } catch (error: unknown) {
            log.warn("Could not list a former folder of a job", { configId, jobId, folder }, wrapError(error));
            continue;
        }

        // Only what really lies inside the folder, in case an adapter lists by a bare prefix.
        const inside = (file: FileInfo) => folderKey(file.path).startsWith(`${folder}/`);
        const backups = listing.filter((file) => isBackupFile(file.name) && inside(file) && !seen.has(folderKey(file.path)));
        const sidecars = await loadBackupSidecars(adapter, config, listing, backups);
        const mine = backups.filter((file) => file.jobId === jobId);
        if (mine.length === 0) continue;

        for (const file of mine) seen.add(folderKey(file.path));
        const own = new Set(mine);
        result.files.push(...mine);
        result.drifted.push(...sidecars.drifted.filter((entry) => own.has(entry.file)));
        result.folders.push({ folder, count: mine.length });
    }
    return result;
}
