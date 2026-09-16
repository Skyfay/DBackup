import type { ExecutionHost } from "@/lib/transport";
import { isCompositeHost } from "@/lib/transport";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { executeQuery, executeQueryWithMessages, type SqlServerMessage } from "./connection";
import { getDialect, type MSSQLDatabaseDialect } from "./dialects";
import { assertValidDatabaseName, toPhysicalFileName } from "./identifiers";
import { buildMoveTargets, getInstanceDefaultPaths, joinServerPath, serverDirname, type MoveTarget } from "./server-paths";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

type RestoreLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

type MSSQLRestoreOneConfig = MSSQLConfig & {
    detectedVersion?: string;
    backupPath?: string;
    localBackupPath?: string;
};

/**
 * Restores one .bak that is already on the server's filesystem into `target.target`.
 *
 * Only a rename needs MOVE. Restoring under the original name leaves the files where the
 * backup already says they belong.
 */
export async function restoreBakFromServer(
    config: MSSQLConfig,
    host: ExecutionHost,
    dialect: MSSQLDatabaseDialect,
    serverPath: string,
    target: { original: string; target: string },
    log: RestoreLog
): Promise<void> {
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
    if (target.original !== target.target) {
        // The target name becomes a filename here, so path separators have
        // to go - same substitution SQL Server applies to its own files.
        const fileBaseName = toPhysicalFileName(target.target);
        const defaults = await getInstanceDefaultPaths(config, host);
        moveOptions = buildMoveTargets(logicalFiles, fileBaseName, defaults);

        const directory = moveOptions.length > 0 ? serverDirname(moveOptions[0].physicalPath) : null;
        if (directory) log(`Placing database files in: ${directory}`);
    }

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

    try {
        if (useSSH) {
            log(`Uploading backup file → ${serverPath}`);
            await host.putFile(filePath, serverPath);
        } else {
            log(`Copying backup file to server...`);
            await fs.copyFile(filePath, sharedPath);
            log(`Backup file staged at: ${serverPath} (local: ${sharedPath})`);
        }

        await restoreBakFromServer(config, host, dialect, serverPath, {
            original: originalDbName ?? targetDbName,
            target: targetDbName,
        }, log);
    } finally {
        if (useSSH) {
            await host.removeFile(serverPath).catch(() => {});
        } else {
            await fs.unlink(sharedPath).catch(() => {});
        }
    }
}
