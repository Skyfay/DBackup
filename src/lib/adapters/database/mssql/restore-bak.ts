import type { ExecutionHost } from "@/lib/transport";
import { isCompositeHost } from "@/lib/transport";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { executeQuery, executeQueryWithMessages, type SqlServerMessage } from "./connection";
import { getDialect, type MSSQLDatabaseDialect } from "./dialects";
import { assertValidDatabaseName, escapeTSqlString, toPhysicalFileName, validateDatabaseName } from "./identifiers";
import { buildMoveTargets, getInstanceDefaultPaths, joinServerPath, serverDirname, type MoveReason, type MoveTarget } from "./server-paths";
import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { assertSharedFolderOffOwnData } from "./shared-folder";

type RestoreLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

type MSSQLRestoreOneConfig = MSSQLConfig & {
    detectedVersion?: string;
    backupPath?: string;
    localBackupPath?: string;
    /** A customer's restore of a shared database, set by the archive restore. See `restoreBakFromServer`. */
    sharedRestore?: boolean;
};

const nameOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Which server made a .bak: this one, another one, or one whose name could not be read. */
type BackupOrigin = "same" | "other" | "unknown";

/**
 * Which server the .bak was made on, by the name of the server the backup records against the
 * names this one answers to. The file paths in a backup of another server are those of that server,
 * which may not exist here or belong to another database, like a database moved to another server
 * under the same name. A name that cannot be read, of the backup or of this server, is `unknown`,
 * which `keepsItsFiles` decides.
 */
async function backupOrigin(config: MSSQLConfig, host: ExecutionHost, serverPath: string): Promise<BackupOrigin> {
    try {
        const header = await executeQuery(config, host, `RESTORE HEADERONLY FROM DISK = N'${serverPath.replace(/'/g, "''")}'`);
        const made = nameOf((header.recordset?.[0] as Record<string, unknown> | undefined)?.ServerName);
        const here = await executeQuery(config, host, "SELECT @@SERVERNAME AS ServerName, CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS PropertyName");
        const row = here.recordset?.[0] as Record<string, unknown> | undefined;
        const names = [nameOf(row?.ServerName), nameOf(row?.PropertyName)].filter((name): name is string => name !== null);
        if (!made || names.length === 0) return "unknown";
        return names.some((name) => name.toLowerCase() === made.toLowerCase()) ? "same" : "other";
    } catch {
        return "unknown";
    }
}

/**
 * Whether every physical path the backup records is a file of the target database already, by
 * `sys.master_files` of that database. Then the restore replaces its own files where they are,
 * whichever server made the backup, which a full-text catalog or a FILESTREAM container needs,
 * since those take no MOVE here. A path missing, or a query that fails, answers false.
 */
async function keepsItsFiles(config: MSSQLConfig, host: ExecutionHost, targetDb: string, files: readonly { physicalName: string }[]): Promise<boolean> {
    const paths = files.map((file) => file.physicalName);
    if (paths.length === 0 || paths.some((value) => typeof value !== "string" || value.length === 0)) return false;
    try {
        const result = await executeQuery(
            config,
            host,
            "SELECT physical_name AS OwnPath FROM sys.master_files " +
                `WHERE database_id = DB_ID(N'${escapeTSqlString(targetDb)}') AND physical_name IN (${paths.map((value) => `N'${escapeTSqlString(value)}'`).join(", ")})`
        );
        // SQL Server compares the paths by the collation of the server, mostly without case, like Windows does.
        const own = new Set((result.recordset ?? [])
            .map((row: Record<string, unknown>) => row.OwnPath)
            .filter((value: unknown): value is string => typeof value === "string")
            .map((value: string) => value.toLowerCase()));
        return paths.every((value) => own.has(value.toLowerCase()));
    } catch {
        return false;
    }
}

/**
 * Refuses MOVE targets that are files of another database of the server. The restore runs with
 * `REPLACE`, which overwrites such a file where its database is offline, and SQL Server lists the
 * files of every attached database, offline ones included, in `sys.master_files`. A file of the
 * target database itself is what a restore over it replaces, so it stays allowed.
 */
async function assertMoveTargetsFree(config: MSSQLConfig, host: ExecutionHost, targetDb: string, moves: MoveTarget[]): Promise<void> {
    if (moves.length === 0) return;
    const paths = moves.map((move) => `N'${escapeTSqlString(move.physicalPath)}'`).join(", ");
    const result = await executeQuery(
        config,
        host,
        "SELECT physical_name AS TakenPath FROM sys.master_files " +
            `WHERE physical_name IN (${paths}) AND database_id <> ISNULL(DB_ID(N'${escapeTSqlString(targetDb)}'), -1)`
    );
    const taken = (result.recordset ?? [])
        .map((row: Record<string, unknown>) => row.TakenPath)
        .find((value: unknown): value is string => typeof value === "string" && value.length > 0);
    if (taken) {
        throw new Error(
            `Cannot restore ${targetDb}: its file ${taken} is a file of another database on the server. ` +
                "Restore under another name, or move or drop that database first."
        );
    }
}

/**
 * Restores one .bak that is already on the server's filesystem into `target.target`.
 *
 * A rename needs MOVE, and so does a backup made on another server, whose files go to the data
 * folder of this one. Restoring under the original name on the server that made the backup leaves
 * the files where the backup already says they belong, and so does a backup whose server could not
 * be read while every file it records is a file of the target database already.
 *
 * A customer's restore of a shared database (`options.shared`) never follows the paths of the
 * backup. Its files always go to the default data and log folders of the instance under the name
 * of the database, since a customer who may change the files of their database could otherwise
 * point a later restore at a file of another database. Afterwards it switches off TRUSTWORTHY and
 * cross database ownership chaining, should the backup carry them, so the code of the database
 * stays inside it.
 */
export async function restoreBakFromServer(
    config: MSSQLConfig,
    host: ExecutionHost,
    dialect: MSSQLDatabaseDialect,
    serverPath: string,
    target: { original: string; target: string },
    log: RestoreLog,
    options: { shared?: boolean } = {}
): Promise<void> {
    const shared = options.shared === true;
    log(`Restoring from: ${serverPath}`);

    // Get file list from backup to determine logical names
    const fileListQuery = `RESTORE FILELISTONLY FROM DISK = N'${serverPath.replace(/'/g, "''")}'`;
    const fileListResult = await executeQuery(config, host, fileListQuery);

    const logicalFiles = fileListResult.recordset.map((row: { LogicalName: string; Type: string; PhysicalName: string }) => ({
        logicalName: row.LogicalName,
        type: row.Type, // D = Data, L = Log
        physicalName: row.PhysicalName,
    }));

    log(`Backup contains ${logicalFiles.length} file(s)`);
    log(`Restoring database: ${target.original} -> ${target.target}`);

    let moveOptions: MoveTarget[] | undefined;
    const origin = !shared && target.original === target.target ? await backupOrigin(config, host, serverPath) : null;
    // A backup of a server whose name could not be read moves like one of another server, unless
    // every file it records is a file of the target database already.
    let movedFrom: Extract<MoveReason, "other" | "unknown"> | null = origin === "other" ? "other" : null;
    if (origin === "other") log("The backup was made on another server, so its files go to the data folder of this one.");
    if (origin === "unknown") {
        if (await keepsItsFiles(config, host, target.target, logicalFiles)) {
            log(`The server that made the backup could not be read. Every file of the backup is a file of ${target.target} already, so its files stay where they are.`);
        } else {
            movedFrom = "unknown";
            log("The server that made the backup could not be read, so its files go to the data folder of this one.");
        }
    }
    if (shared) log("A restore of a shared database puts its files into the data folder of the server.");
    if (target.original !== target.target || movedFrom || shared) {
        // The target name becomes a filename here, so path separators have
        // to go - same substitution SQL Server applies to its own files.
        const fileBaseName = toPhysicalFileName(target.target);
        const defaults = await getInstanceDefaultPaths(config, host);
        moveOptions = buildMoveTargets(logicalFiles, fileBaseName, defaults, { backupFolders: !shared, reason: movedFrom ?? "rename" });

        const directory = moveOptions.length > 0 ? serverDirname(moveOptions[0].physicalPath) : null;
        if (directory) log(`Placing database files in: ${directory}`);
    }
    // The files land at the MOVE targets, or without MOVE at the paths the backup records, and
    // REPLACE overwrites either where it is a file of another database, so both are checked.
    await assertMoveTargetsFree(
        config,
        host,
        target.target,
        moveOptions ?? logicalFiles
            .filter((file) => typeof file.physicalName === "string" && file.physicalName.length > 0)
            .map((file) => ({ logicalName: file.logicalName, physicalPath: file.physicalName }))
    );

    const restoreQuery = dialect.getRestoreQuery(target.target, serverPath, {
        replace: true,
        recovery: true,
        stats: 10,
        moveFiles: moveOptions,
    });

    log(`Executing restore`, "info", "command", restoreQuery);

    try {
        // Use requestTimeout=0 (no timeout) - large DB restores can run for hours.
        // Stream progress messages in real-time so the UI shows live updates.
        await executeQueryWithMessages(config, host, restoreQuery, undefined, 0, (msg: SqlServerMessage) => {
            if (msg.message) {
                log(`SQL Server: ${msg.message}`, "info", "general");
            }
        });

        log(`Restore completed for: ${target.target}`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Restore failed for ${target.target}: ${message}`, "error");
        throw error;
    }

    if (shared) await keepCodeInsideDatabase(config, host, target.target, log);
}

/**
 * Switches off TRUSTWORTHY and cross database ownership chaining of a restored shared database
 * where the backup brought either along. With TRUSTWORTHY on, a module of the database that runs
 * `EXECUTE AS OWNER` reaches the server with the rights of the database's owner, which after a
 * restore is often the provider's login. Only a sysadmin changes either setting, so a login that is none
 * leaves a warning instead of failing a restore that already wrote the database.
 */
async function keepCodeInsideDatabase(config: MSSQLConfig, host: ExecutionHost, database: string, log: RestoreLog): Promise<void> {
    const literal = escapeTSqlString(database);
    const quoted = validateDatabaseName(database);
    const query =
        `IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'${literal}' AND is_trustworthy_on = 1) ALTER DATABASE [${quoted}] SET TRUSTWORTHY OFF; ` +
        `IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'${literal}' AND is_db_chaining_on = 1) ALTER DATABASE [${quoted}] SET DB_CHAINING OFF;`;
    try {
        await executeQuery(config, host, query);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Could not switch off TRUSTWORTHY and cross database ownership chaining of ${database}: ${message}`, "warning");
    }
}

/**
 * Restores a single plain .bak, as produced by dumpOne, into `targetDbName`.
 *
 * The file is staged under a unique name so two restores running at once cannot pick up
 * each other's backup, and the staged copy is removed afterwards either way.
 */
export async function restoreOne(
    config: MSSQLRestoreOneConfig,
    filePath: string,
    targetDbName: string,
    host: ExecutionHost,
    onLog?: RestoreLog,
    _onProgress?: (percentage: number, detail?: string) => void,
    originalDbName?: string
): Promise<void> {
    const log: RestoreLog = (msg, level = "info", type = "general", details) => onLog?.(msg, level, type, details);
    assertValidDatabaseName(targetDbName);

    const dialect = getDialect(config.detectedVersion);
    const serverBackupPath = config.backupPath || "/var/opt/mssql/backup";
    const useSSH = host.kind !== "direct" || isCompositeHost(host);
    const localBackupPath = config.localBackupPath || "/tmp";

    const fileName = `dbackup-restore-${crypto.randomUUID()}.bak`;
    const serverPath = joinServerPath(serverBackupPath, fileName);
    const sharedPath = path.join(localBackupPath, fileName);
    // No restore stages a backup in the own data of DBackup, also through a link that points there by now.
    if (!useSSH) await assertSharedFolderOffOwnData(localBackupPath);

    try {
        if (useSSH) {
            log(`Uploading backup file → ${serverPath}`);
            await host.putFile(filePath, serverPath);
        } else {
            log(`Copying backup file to server...`);
            // A stream copy, not `copyFile`, which would keep the 0600 of the private staging. The
            // copy takes the default mode, so a SQL Server running as another user, like a container
            // behind a bind mount, can read it. The staged original stays in the private folder.
            await pipeline(createReadStream(filePath), createWriteStream(sharedPath, { flags: "wx" }));
            log(`Backup file staged at: ${serverPath} (local: ${sharedPath})`);
        }

        await restoreBakFromServer(config, host, dialect, serverPath, {
            original: originalDbName ?? targetDbName,
            target: targetDbName,
        }, log, { shared: config.sharedRestore === true });
    } finally {
        if (useSSH) {
            await host.removeFile(serverPath).catch(() => {});
        } else {
            await fs.unlink(sharedPath).catch(() => {});
        }
    }
}
