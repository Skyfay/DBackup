import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { ensureDatabase } from "./connection";
import { getDialect } from "./dialects";
import { getMysqlCommand } from "./tools";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { waitForProcess } from "@/lib/adapters/process";
import {
    isMultiDbTar,
    extractMultiDbTar,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth.password : config.password;

    for (const dbName of databases) {
        await ensureDatabase(config, dbName, user, pass, usePrivileged, []);
    }
}

/**
 * Restore a single SQL file to a specific database
 */
async function restoreSingleFile(
    config: any,
    sourcePath: string,
    targetDb: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number) => void
): Promise<void> {
    const stats = await fs.stat(sourcePath);
    const totalSize = stats.size;
    let processedSize = 0;
    let lastProgress = 0;

    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    const args = dialect.getRestoreArgs(config, targetDb);

    const env = { ...process.env };
    if (config.password) env.MYSQL_PWD = config.password;

    onLog(`Restoring to database: ${targetDb}`, 'info', 'command', `${getMysqlCommand()} ${args.join(' ')}`);

    const mysqlProc = spawn(getMysqlCommand(), args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    const fileStream = createReadStream(sourcePath, { highWaterMark: 64 * 1024 });

    fileStream.on('data', (chunk) => {
        if (onProgress && totalSize > 0) {
            processedSize += chunk.length;
            const p = Math.round((processedSize / totalSize) * 100);
            if (p > lastProgress) {
                lastProgress = p;
                onProgress(p);
            }
        }
    });

    fileStream.on('error', () => mysqlProc.kill());
    mysqlProc.stdin.on('error', () => { /* ignore broken pipe */ });

    fileStream.pipe(mysqlProc.stdin);

    await waitForProcess(mysqlProc, 'mysql', (d) => {
        const msg = d.toString().trim();
        if (msg.includes("Using a password") || msg.includes("Deprecated program name")) return;
        onLog(`MySQL: ${msg}`);
    });
}

export async function restore(config: any, sourcePath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        const dbMapping = config.databaseMapping as { originalName: string, targetName: string, selected: boolean }[] | undefined;
        const usePrivileged = !!config.privilegedAuth;
        const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
        const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

        // Check if this is a Multi-DB TAR archive
        if (await isMultiDbTar(sourcePath)) {
            log(`Detected Multi-DB TAR archive`);

            const tempDir = await createTempDir("mysql-restore-");

            try {
                const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);
                log(`Archive contains ${manifest.databases.length} database(s): ${manifest.databases.map(d => d.name).join(', ')}`);

                let restoredCount = 0;

                for (const dbEntry of manifest.databases) {
                    // Check if this database should be restored
                    if (!shouldRestoreDatabase(dbEntry.name, dbMapping)) {
                        log(`Skipping database: ${dbEntry.name} (not selected)`);
                        continue;
                    }

                    const targetDb = getTargetDatabaseName(dbEntry.name, dbMapping);
                    const dbFile = files.find(f => path.basename(f) === dbEntry.filename);

                    if (!dbFile) {
                        throw new Error(`Database file not found in archive: ${dbEntry.filename}`);
                    }

                    // Ensure target database exists
                    await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);

                    // Restore this database
                    await restoreSingleFile(config, dbFile, targetDb, log, onProgress);
                    log(`Restored database: ${dbEntry.name} → ${targetDb}`);
                    restoredCount++;
                }

                log(`Multi-DB restore completed: ${restoredCount} database(s) restored`);

                return { success: true, logs, startedAt, completedAt: new Date() };
            } finally {
                await cleanupTempDir(tempDir);
            }
        }

        // Single-DB restore (regular SQL file)
        let targetDb: string;

        if (dbMapping && dbMapping.length > 0) {
            const selected = dbMapping.filter(m => m.selected);
            if (selected.length === 0) {
                throw new Error("No databases selected for restore");
            }
            targetDb = selected[0].targetName || selected[0].originalName;
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);
        } else if (config.database) {
            targetDb = Array.isArray(config.database) ? config.database[0] : config.database;
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);
        } else {
            throw new Error("No target database specified for restore");
        }

        await restoreSingleFile(config, sourcePath, targetDb, log, onProgress);

        return { success: true, logs, startedAt, completedAt: new Date() };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Error: ${msg}`, 'error');
        return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
