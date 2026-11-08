import type { ExecutionHost } from "@/lib/transport";
import type { MSSQLConfig } from "@/lib/adapters/definitions";
import { executeQuery } from "./connection";
import path from "path";

/**
 * Paths as SQL Server sees them.
 *
 * Every other path in this adapter belongs to the machine DBackup runs on, and
 * `path` handles those. These belong to the SQL Server host, which is a Windows
 * machine often enough that a POSIX assumption is a bug rather than a
 * simplification: a Windows server resolves `/var/opt/mssql/data/x.mdf`
 * against the current drive and fails with operating system error 3.
 */

/** ASCII "/" and "\" - compared by code unit so no substring is allocated while scanning. */
const SLASH = 47;
const BACKSLASH = 92;

/** Trailing separators of either kind, in one pass. See @/lib/paths for why not a regex. */
function stripTrailingSeparators(value: string): string {
    let end = value.length;
    while (end > 0) {
        const code = value.charCodeAt(end - 1);
        if (code !== SLASH && code !== BACKSLASH) break;
        end--;
    }
    return value.slice(0, end);
}

/**
 * Join a server-side directory and a file name, keeping the separator the
 * directory already uses.
 *
 * Deliberately not "is this a Windows path". A drive letter says nothing about
 * the separator: `D:\SQLBackup` and `D:/SQLBackup` both address the same
 * directory, but only the second is usable over SFTP, where `\` is an ordinary
 * character rather than a separator. Following what the operator wrote keeps
 * every existing config producing the exact path it produced before.
 *
 * `D:\SQLBackup/db.bak` would reach the right file too, since Win32 accepts
 * either separator. It is the run log and the error message that make the
 * difference: a mangled-looking path is the first thing suspected when
 * something else is actually wrong.
 */
export function joinServerPath(directory: string, fileName: string): string {
    if (!directory.includes("\\")) {
        return path.posix.join(directory, fileName);
    }
    return `${stripTrailingSeparators(directory)}\\${fileName}`;
}

/** The directory part of a server-side path, or null when the path carries none. */
export function serverDirname(value: string): string | null {
    const trimmed = stripTrailingSeparators(value);

    let end = trimmed.length;
    while (end > 0) {
        const code = trimmed.charCodeAt(end - 1);
        if (code === SLASH || code === BACKSLASH) break;
        end--;
    }
    if (end === 0) return null;

    // A filesystem root is its own separator, so stripping it leaves nothing.
    const directory = stripTrailingSeparators(trimmed.slice(0, end));
    return directory.length > 0 ? directory : trimmed.slice(0, end);
}

export interface InstanceDefaultPaths {
    data?: string;
    log?: string;
}

/**
 * The instance's own default data and log directories.
 *
 * `InstanceDefaultDataPath` exists from SQL Server 2012 SP1 and returns NULL on
 * some instances even where it exists, and SERVERPROPERTY answers NULL rather
 * than failing for a property an older server has never heard of. Both fields
 * are therefore optional and the caller needs a fallback. This never throws: a
 * server that will not answer is the same case as one that answers NULL.
 */
export async function getInstanceDefaultPaths(
    config: MSSQLConfig,
    host: ExecutionHost,
): Promise<InstanceDefaultPaths> {
    try {
        const result = await executeQuery(
            config,
            host,
            "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(4000)) AS DataPath, " +
                "CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(4000)) AS LogPath",
        );

        const row = result.recordset?.[0] as Record<string, unknown> | undefined;
        return { data: readPath(row?.DataPath), log: readPath(row?.LogPath) };
    } catch {
        return {};
    }
}

function readPath(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/** One row of RESTORE FILELISTONLY, narrowed to the columns that decide placement. */
export interface RestoreFileEntry {
    logicalName: string;
    type: string;
    physicalName: string;
}

export interface MoveTarget {
    logicalName: string;
    physicalPath: string;
}

/**
 * Where the restored files land when the database is being renamed.
 *
 * Restoring under the original name needs none of this, because the backup
 * already records where its files belong. A rename does, since two databases
 * cannot share one .mdf.
 *
 * The instance default comes first: it is where SQL Server would put a new
 * database anyway, and it is correct on Windows and Linux alike. The directory
 * the file came from is the fallback, which is right whenever the restore
 * targets the server that wrote the backup, and that is the normal case for a
 * rename.
 *
 * `backupFolders: false` drops that fallback, for a restore whose backup names paths that nobody
 * may follow, like a customer's shared database, whose files then go to the instance defaults alone.
 */
export function buildMoveTargets(
    files: RestoreFileEntry[],
    baseName: string,
    defaults: InstanceDefaultPaths,
    options: { backupFolders?: boolean } = {},
): MoveTarget[] {
    const backupFolders = options.backupFolders ?? true;
    let dataFiles = 0;
    let logFiles = 0;

    return files.map((file) => {
        const type = file.type?.trim().toUpperCase();
        if ((type !== "D" && type !== "L") && !backupFolders) {
            throw new Error(
                `Cannot restore '${file.logicalName}' into the data folder of the server. The backup contains ` +
                    `a file of type '${file.type}', which SQL Server places by directory rather than by file name.`,
            );
        }
        if (type !== "D" && type !== "L") {
            // Full-text catalogs and FILESTREAM containers are directories, not
            // files, so there is no name to derive here. Restoring under the
            // original name still works and is the way to move these.
            throw new Error(
                `Cannot restore '${file.logicalName}' under a different database name. ` +
                    `The backup contains a file of type '${file.type}', which SQL Server places by ` +
                    `directory rather than by file name. Restore under the original database name instead.`,
            );
        }

        const isLog = type === "L";
        const instanceDefault = isLog ? defaults.log : defaults.data;
        // Without the folders of the backup, a log file falls back to the data folder of the instance.
        const directory = backupFolders ? instanceDefault ?? serverDirname(file.physicalName) : instanceDefault ?? defaults.data ?? null;
        if (!directory && !backupFolders) {
            throw new Error(
                `Cannot determine where to place '${file.logicalName}' on the server. ` +
                    `The instance reports no default ${isLog ? "log" : "data"} directory. Set the default ` +
                    `data and log folders of the instance in its server properties.`,
            );
        }
        if (!directory) {
            throw new Error(
                `Cannot determine where to place '${file.logicalName}' on the server. ` +
                    `The instance reports no default ${isLog ? "log" : "data"} directory and the backup ` +
                    `records no directory for this file. Restore under the original database name instead.`,
            );
        }

        // A database can hold several data files, and every one of them would
        // otherwise be moved onto the same .mdf. A second log file is no `_2.ldf`,
        // which is the log of a database called `<name>_2`. A database name can hold
        // any character, so no name rules out every clash, and `assertMoveTargetsFree`
        // in restore-bak.ts refuses a MOVE onto a file of another database.
        let suffix: string;
        if (isLog) {
            logFiles++;
            suffix = logFiles === 1 ? ".ldf" : `_log${logFiles}.ldf`;
        } else {
            dataFiles++;
            suffix = dataFiles === 1 ? ".mdf" : `_${dataFiles}.ndf`;
        }

        return {
            logicalName: file.logicalName,
            physicalPath: joinServerPath(directory, `${baseName}${suffix}`),
        };
    });
}
