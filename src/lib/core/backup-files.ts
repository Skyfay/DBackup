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
 * Every sidecar path belonging to a backup.
 *
 * Deleting a backup must remove these too, otherwise orphaned sidecars accumulate and
 * later confuse listings and statistics.
 */
export function sidecarPathsFor(backupPath: string): string[] {
    return SIDECAR_SUFFIXES.map((suffix) => backupPath + suffix);
}
