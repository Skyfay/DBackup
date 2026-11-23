/**
 * Classification of files stored alongside a backup.
 *
 * Every backup writes sidecar files next to the archive itself. Any code that lists a
 * storage destination and asks "which of these are backups?" has to exclude them, and
 * getting that wrong is dangerous rather than cosmetic: retention counts files to decide
 * what to delete, so a sidecar mistaken for a backup can push a real backup out of the
 * keep window and delete it.
 *
 * That is exactly what happened when the `.index` sidecar was introduced - seven separate
 * call sites each hard-coded `!name.endsWith('.meta.json')` and none of them learned about
 * the new suffix. Hence this single source of truth: adding a future sidecar means adding
 * it here, once.
 */

import { INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";
import type { FileInfo } from "@/lib/core/interfaces";

/** Metadata sidecar written for every backup. */
export const METADATA_SIDECAR_SUFFIX = ".meta.json";

/**
 * Every suffix that marks a file as a sidecar rather than a backup.
 * Order matters for nothing, but every entry must be a full filename suffix.
 */
export const SIDECAR_SUFFIXES: readonly string[] = [
    METADATA_SIDECAR_SUFFIX,
    INDEX_SIDECAR_SUFFIX,
];

/** True when the filename is a sidecar rather than a backup in its own right. */
export function isSidecarFile(name: string): boolean {
    return SIDECAR_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * True when the file is an actual backup.
 *
 * Use this instead of open-coding a suffix check when filtering a storage listing.
 */
export function isBackupFile(name: string): boolean {
    return !isSidecarFile(name);
}

/**
 * The time a backup should be judged by.
 *
 * `lastModified` is whatever the destination reports as the file's modification time, and
 * that is not the same thing as when the backup was taken. A copy without `-p`, a move
 * between servers, or restoring the backup directory itself resets every mtime to now, at
 * which point retention sees one giant bucket and deletes almost everything in it.
 *
 * `backupTimestamp` comes from the backup's own sidecar, written by DBackup at upload, and
 * survives all of that. It is missing for backups that predate it and for destinations
 * whose adapter cannot read, so the mtime remains the fallback rather than the rule.
 */
export function effectiveBackupTime(file: FileInfo): Date {
    return file.backupTimestamp ?? file.lastModified;
}

/**
 * Every sidecar path belonging to a backup.
 *
 * Deleting a backup must remove these too, otherwise orphaned sidecars accumulate and
 * later confuse listings and statistics.
 */
export function sidecarPathsFor(backupPath: string): string[] {
    return SIDECAR_SUFFIXES.map((suffix) => backupPath + suffix);
}

/**
 * The name the runner gives the folder of a chain, `chain-` and the moment it started, see
 * `chainDirName` in `chain-planner.ts`. Only that name counts, so the folder of a job that is
 * itself called `chain-something` never reads as a chain.
 */
export const CHAIN_FOLDER_NAME = /^chain-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/;

/**
 * The incremental chain folder a backup lives in, or null for a flat full backup.
 *
 * The runner names these `chain-<timestamp>` inside the folder of the job, and the folder
 * layout is what defines the chain. Anything asking "does something else depend on this
 * archive?" starts here.
 */
export function chainFolderOf(backupPath: string): string | null {
    const normalized = backupPath.replace(/\\/g, "/");
    const separator = normalized.lastIndexOf("/");
    if (separator === -1) return null;
    const folder = normalized.slice(0, separator);
    const parent = folder.lastIndexOf("/");
    return parent !== -1 && CHAIN_FOLDER_NAME.test(folder.slice(parent + 1)) ? folder : null;
}
