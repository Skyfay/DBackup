import { stripTrailingDotsAndSpaces } from "@/lib/paths";
import { firstFolders } from "@/lib/core/job-folder";

/**
 * Where the configuration backup lies on a destination. Its file is a copy of the whole DBackup
 * database with `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in it, so whatever reads a backup by its
 * path asks this first, see `src/lib/server/config-backup-guard.ts`.
 */

/** The folder at the root of a destination of the home tenant the configuration backup writes to. */
export const CONFIG_BACKUP_FOLDER = "config-backups";

/** How the name of a file of the configuration backup starts. */
export const CONFIG_BACKUP_FILE_PREFIX = "config_backup_";

/**
 * Whether a part of a path names the folder of the configuration backup. Some storages ignore the
 * case and Windows drops dots and spaces at the end of a name, so `Config-Backups.` is that folder
 * there too. The upper case is compared as well, since a letter like `ſ` turns into `S` only that
 * way, like `isTenantsSegment`.
 */
export function isConfigBackupSegment(part: string): boolean {
    const name = stripTrailingDotsAndSpaces(part);
    return name.toLowerCase() === CONFIG_BACKUP_FOLDER || name.toUpperCase() === CONFIG_BACKUP_FOLDER.toUpperCase();
}

/**
 * Whether a job of this name would write into the folder of the configuration backup. A job writes
 * into the folder its name gives, so `config-backups` does and so does `Config-Backups./nightly`,
 * and `x/../config-backups` too, whose first folder a path resolves to that one.
 */
export function isConfigBackupFolderName(name: string): boolean {
    return firstFolders(name).some(isConfigBackupSegment);
}

/** What someone reads who names a job like the folder of the configuration backup. */
export const CONFIG_BACKUP_FOLDER_NAME = `A job cannot be called ${CONFIG_BACKUP_FOLDER}, that folder holds the configuration backups of DBackup.`;

/** The parts of a path, with either slash, without empty parts and `.`. */
const partsOf = (file: string) => file.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");

/**
 * Whether a path names a file of the configuration backup: one in `config-backups/` at the root, or
 * one named like its files anywhere. Some storages ignore the case and Windows drops dots and spaces
 * at the end of a name, so `Config-Backups./` is that folder there too.
 */
export function isConfigBackupPath(file: string): boolean {
    const parts = partsOf(file);
    if (parts.length === 0) return false;
    return isConfigBackupSegment(parts[0]) || parts[parts.length - 1].toLowerCase().startsWith(CONFIG_BACKUP_FILE_PREFIX);
}

/** Whether a path lies in `config-backups/` at the root, in every spelling `isConfigBackupSegment` knows. */
export function isInConfigBackupFolder(file: string): boolean {
    const parts = partsOf(file);
    return parts.length > 1 && isConfigBackupSegment(parts[0]);
}

