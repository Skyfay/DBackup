import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { getDialect } from "./dialects";
import { getDatabases } from "./connection";
import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry } from "../common/types";
import { awaitDumpProcess } from "../common/dump-process";
import { MYSQL_DUMP, withAuthArgs } from "./args";

/** Extended config with runtime fields */
type MySQLDumpConfig = (MySQLConfig | MariaDBConfig) & {
    type?: string;
    detectedVersion?: string;
};

/**
 * Dump a single database to a file
 */
async function dumpSingleDatabase(
    config: MySQLDumpConfig,
    dbName: string,
    destinationPath: string,
    host: ExecutionHost,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    const dumpBin = await host.which(...MYSQL_DUMP);
    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    // Both transports now get the version-aware dialect flags. The SSH path used
    // to hand-roll a smaller argument set and miss them entirely.
    const args = dialect.getDumpArgs(config, [dbName], host);

    const safeCmd = `${dumpBin} ${args.join(' ').replace(config.password || '___NONE___', '******')}`;
    onLog(`Dumping database: ${dbName}`, 'info', 'command', safeCmd);

    // mysqldump writes to stdout, and a host process delivers stdout to this
    // machine whatever the transport is. The bytes are already local, so they
    // are written straight to the destination. Wrapping this in captureOutput
    // would name a path on the remote host and then write it with the local
    // fs, which happens to work in direct mode because the two are the same
    // path, and fails over SSH with "No such file" on the download.
    await withAuthArgs(host, config.password, async (authArgs) => {
        const proc = await host.spawn([dumpBin, ...authArgs, ...args]);
        const writeStream = createWriteStream(destinationPath);

        proc.stdout.pipe(writeStream);
        proc.stderr.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            // Benign noise from the MariaDB tools.
            if (msg.includes("Using a password") || msg.includes("Deprecated program name")) return;
            onLog(msg);
        });

        await awaitDumpProcess(proc, writeStream, dumpBin);
    });

    const stats = await fs.stat(destinationPath);
    if (stats.size === 0) {
        throw new Error(`Dump file for ${dbName} is empty. Check logs/permissions.`);
    }

    return { success: true, size: stats.size };
}

/**
 * Capability export for combined DB+directory backups (JobSource): dumps exactly one
 * database to a plain file, without any TAR/manifest wrapping. Thin wrapper around the
 * same per-database logic dump() already uses internally for its own multi-DB case.
 */
export async function dumpOne(
    config: MySQLDumpConfig,
    dbName: string,
    destinationPath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    const result = await dumpSingleDatabase(config, dbName, destinationPath, _host, onLog ?? (() => {}));
    return { size: result.size };
}

// LEGACY-FORMAT(write): Writes a backup in the format used before the seekable archive.
// No job calls it anymore, only tests do. Remove it together with DatabaseAdapter.dump.
export async function dump(config: MySQLDumpConfig, destinationPath: string, _host: ExecutionHost, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, _onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        // Determine databases to backup
        let dbs: string[] = [];
        if (Array.isArray(config.database)) dbs = config.database;
        else if (config.database && config.database.includes(',')) dbs = config.database.split(',');
        else if (config.database) dbs = [config.database];

        if (dbs.length === 0) {
            log("No databases selected - backing up all databases");
            dbs = await getDatabases(config, _host);
            log(`Found ${dbs.length} database(s): ${dbs.join(', ')}`);
        }

        if (dbs.length === 0) {
            throw new Error("No databases found on server");
        }

        // Single DB: Direct dump (no TAR needed)
        if (dbs.length === 1) {
            const result = await dumpSingleDatabase(config, dbs[0], destinationPath, _host, log);

            const sizeMB = (result.size / 1024 / 1024).toFixed(2);
            log(`Dump finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: result.size,
                logs,
                startedAt,
                completedAt: new Date(),
            };
        }

        // Multi-DB: Dump each database separately, then pack into TAR
        log(`Multi-database backup: ${dbs.length} databases`);

        const tempDir = await createTempDir("mysql-multidb-");
        const dbFiles: TarFileEntry[] = [];

        try {
            for (const dbName of dbs) {
                const dbFileName = `${dbName}.sql`;
                const dbFilePath = path.join(tempDir, dbFileName);

                await dumpSingleDatabase(config, dbName, dbFilePath, _host, log);

                dbFiles.push({
                    name: dbFileName,
                    path: dbFilePath,
                    dbName,
                    format: "sql",
                });

                log(`Completed dump for: ${dbName}`);
            }

            // Create TAR archive with manifest
            log(`Creating TAR archive with ${dbFiles.length} databases...`);
            const manifest = await createMultiDbTar(dbFiles, destinationPath, {
                sourceType: config.type === 'mariadb' ? 'mariadb' : 'mysql',
                engineVersion: config.detectedVersion,
            });

            const stats = await fs.stat(destinationPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            log(`Multi-DB backup finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: stats.size,
                logs,
                startedAt,
                completedAt: new Date(),
                metadata: {
                    multiDb: {
                        format: 'tar',
                        databases: manifest.databases.map(d => d.name),
                    },
                },
            };
        } finally {
            // Always cleanup temp files
            await cleanupTempDir(tempDir);
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`, 'error');
        return {
            success: false,
            logs,
            error: message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
