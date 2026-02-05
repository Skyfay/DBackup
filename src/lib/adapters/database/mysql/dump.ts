import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { getDialect } from "./dialects";
import { getMysqldumpCommand } from "./tools";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry } from "../common/types";

/**
 * Dump a single database to a file
 */
async function dumpSingleDatabase(
    config: any,
    dbName: string,
    destinationPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    const args = dialect.getDumpArgs(config, [dbName]);

    const env = { ...process.env };
    if (config.password) {
        env.MYSQL_PWD = config.password;
    }

    const safeCmd = `${getMysqldumpCommand()} ${args.join(' ').replace(config.password || '___NONE___', '******')}`;
    onLog(`Dumping database: ${dbName}`, 'info', 'command', safeCmd);

    const dumpProcess = spawn(getMysqldumpCommand(), args, { env });
    const writeStream = createWriteStream(destinationPath);

    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        // Filter benign warnings from MariaDB tools on Alpine
        if (msg.includes("Using a password") || msg.includes("Deprecated program name")) return;
        onLog(msg);
    });

    await new Promise<void>((resolve, reject) => {
        dumpProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${getMysqldumpCommand()} exited with code ${code}`));
        });
        dumpProcess.on('error', (err) => reject(err));
        writeStream.on('error', (err: any) => reject(err));
    });

    const stats = await fs.stat(destinationPath);
    if (stats.size === 0) {
        throw new Error(`Dump file for ${dbName} is empty. Check logs/permissions.`);
    }

    return { success: true, size: stats.size };
}

export async function dump(config: any, destinationPath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, _onProgress?: (percentage: number) => void): Promise<BackupResult> {
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
            throw new Error("No database specified for backup");
        }

        // Single DB: Direct dump (no TAR needed)
        if (dbs.length === 1) {
            const result = await dumpSingleDatabase(config, dbs[0], destinationPath, log);

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

                await dumpSingleDatabase(config, dbName, dbFilePath, log);

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
