import type { ExecutionHost } from "@/lib/transport";
import { isCompositeHost } from "@/lib/transport";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { assertBackupSupported, executeQueryWithMessages, supportsCompression, type SqlServerMessage } from "./connection";
import { getDialect } from "./dialects";
import { toPhysicalFileName } from "./identifiers";
import { joinServerPath } from "./server-paths";
import fs from "fs/promises";
import path from "path";

type MSSQLDumpOneConfig = MSSQLConfig & {
    detectedVersion?: string;
    backupPath?: string;
    localBackupPath?: string;
};

/** Error for a shared-mount backup that SQL Server wrote but DBackup cannot see. */
export function missingOnMountError(localPath: string): Error {
    return new Error(
        `Backup file not found at ${localPath}. ` +
        `Check that localBackupPath is configured correctly and matches your Docker volume mount or shared filesystem. ` +
        `Alternatively, switch to SSH mode for remote SQL Servers.`
    );
}

/**
 * Error for a backup SQL Server reported as written that the SSH side cannot find.
 *
 * The file is missing only in the sense that this connection looks at a different
 * filesystem than SQL Server does. The raw "No such file" gives no hint of that, and it is
 * the single most common way this mode is misconfigured.
 */
export function wrongSshTargetError(error: unknown, serverPath: string): Error {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(
        `${detail}. SQL Server reported the backup as written to ${serverPath}, so that path ` +
        `is not the same directory on the machine this connection reaches. Usual causes: ` +
        `SQL Server runs in a container and the path is not bind-mounted to the identical ` +
        `path on the host, or the SSH connection goes to a different machine than SQL Server.`
    );
}

/**
 * Backs up one database with BACKUP DATABASE into a plain .bak at `destinationPath`.
 *
 * The per-database half of dump(), without packing several .bak files into a tar. The
 * server-side file is always removed afterwards, also when the transfer fails.
 */
export async function dumpOne(
    config: MSSQLDumpOneConfig,
    dbName: string,
    destinationPath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) =>
        onLog?.(msg, level, type, details);

    await assertBackupSupported(config, host);

    const dialect = getDialect(config.detectedVersion);
    const serverBackupPath = config.backupPath || "/var/opt/mssql/backup";
    const useSSH = host.kind !== "direct" || isCompositeHost(host);
    const localBackupPath = config.localBackupPath || "/tmp";

    const useCompression = await supportsCompression(config, host);
    log(useCompression
        ? "Compression enabled (supported by this SQL Server edition)"
        : "Compression disabled (not supported by Express/Web editions)");

    // The name becomes a filename on the server, so it gets the same substitution SQL
    // Server applies to its own physical files.
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bakFileName = `${toPhysicalFileName(dbName)}_${timestamp}.bak`;
    const serverBakPath = joinServerPath(serverBackupPath, bakFileName);
    const sharedPath = path.join(localBackupPath, bakFileName);

    try {
        log(`Backing up database: ${dbName}`, "info", "command");
        const backupQuery = dialect.getBackupQuery(dbName, serverBakPath, { compression: useCompression, stats: 10 });
        log(`Executing backup`, "info", "command", backupQuery);

        // requestTimeout 0: a large database can take hours to back up.
        await executeQueryWithMessages(config, host, backupQuery, undefined, 0, (msg: SqlServerMessage) => {
            if (msg.message) log(`SQL Server: ${msg.message}`, "info", "general");
        });

        if (useSSH) {
            log(`Downloading: ${serverBakPath} → ${destinationPath}`);
            try {
                await host.getFile(serverBakPath, destinationPath);
            } catch (error: unknown) {
                throw wrongSshTargetError(error, serverBakPath);
            }
        } else {
            // With a shared mount the file SQL Server wrote is already visible here.
            const visible = await fs.stat(sharedPath).then(() => true, () => false);
            if (!visible) throw missingOnMountError(sharedPath);
            await fs.copyFile(sharedPath, destinationPath);
        }

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("Backup file is empty. Check permissions and disk space.");
        }
        log(`Backup completed for: ${dbName}`);
        return { size: stats.size };
    } finally {
        if (useSSH) {
            await host.removeFile(serverBakPath).catch(() => {});
        } else {
            await fs.unlink(sharedPath).catch(() => {});
        }
    }
}
