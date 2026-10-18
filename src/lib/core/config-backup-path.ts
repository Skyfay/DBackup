import { stripTrailingDotsAndSpaces } from "@/lib/paths";

/**
 * Where the configuration backup lies on a destination. Its file is a copy of the whole DBackup
 * database with `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in it, so whatever reads a backup by its
 * path asks this first, see `src/lib/server/config-backup-guard.ts`.
 */

/** The folder at the root of a destination of the home tenant the configuration backup writes to. */
export const CONFIG_BACKUP_FOLDER = "config-backups";

/** How the name of a file of the configuration backup starts. */
export const CONFIG_BACKUP_FILE_PREFIX = "config_backup_";

/** A part of a path as a storage that ignores the case and drops dots and spaces at the end reads it. */
const folded = (part: string) => stripTrailingDotsAndSpaces(part).toLowerCase();

/**
 * Whether a path names a file of the configuration backup: one in `config-backups/` at the root, or
 * one named like its files anywhere. Some storages ignore the case and Windows drops dots and spaces
 * at the end of a name, so `Config-Backups./` is that folder there too.
 */
export function isConfigBackupPath(file: string): boolean {
    const parts = file.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    if (parts.length === 0) return false;
    return folded(parts[0]) === CONFIG_BACKUP_FOLDER || parts[parts.length - 1].toLowerCase().startsWith(CONFIG_BACKUP_FILE_PREFIX);
}
