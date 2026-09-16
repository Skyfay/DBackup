import type { ExecutionHost } from "@/lib/transport";
import { LogLevel, LogType } from "@/lib/core/logs";
import { BackupResult } from "@/lib/core/interfaces";
import fs from "fs/promises";
import path from "path";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { PostgresConfig } from "@/lib/adapters/definitions";
import { PG_RESTORE, PSQL, buildConnectionArgs, pgEnv } from "./args";

/**
 * Extended PostgreSQL config for restore operations with runtime fields
 */
type PostgresRestoreConfig = PostgresConfig & {
    detectedVersion?: string;
    privilegedAuth?: {
        user: string;
        password: string;
    };
    databaseMapping?: Array<{
        originalName: string;
        targetName: string;
        selected: boolean;
    }>;
};

export async function prepareRestore(
    config: PostgresRestoreConfig,
    databases: string[],
    host: ExecutionHost,
): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth!.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth!.password : config.password;

    const psql = await host.which(...PSQL);
    const args = [...buildConnectionArgs(config, { user }), "-d", "postgres"];
    const env = pgEnv(pass);

    for (const dbName of databases) {
        // Dollar-free literal quoting: the name is a value here, not an identifier.
        const safeLiteral = dbName.replace(/'/g, "''");
        const exists = await host.exec(
            [psql, ...args, "-t", "-A", "-c", `SELECT 1 FROM pg_database WHERE datname = '${safeLiteral}'`],
            { env },
        );
        if (exists.code === 0 && exists.stdout.trim() === "1") continue;

        const safeDbName = `"${dbName.replace(/"/g, '""')}"`;
        const created = await host.exec([psql, ...args, "-c", `CREATE DATABASE ${safeDbName}`], { env });

        if (created.code !== 0) {
            const message = created.stderr || "";
            if (message.includes("permission denied")) {
                throw new Error(`Access denied for user '${user}' to create database '${dbName}'. User permissions?`);
            }
            if (message.includes("already exists")) continue;
            throw new Error(`Failed to create database '${dbName}': ${message.trim()}`);
        }
    }
}

/**
 * Detect if a backup file is in PostgreSQL custom format
 */
async function isCustomFormat(filePath: string): Promise<boolean> {
    try {
        const buffer = Buffer.alloc(5);
        const handle = await fs.open(filePath, 'r');
        await handle.read(buffer, 0, 5, 0);
        await handle.close();
        return buffer.toString('ascii', 0, 5) === 'PGDMP';
    } catch {
        return false;
    }
}

/**
 * Restore one database with pg_restore.
 *
 * pg_restore needs seekable input for the custom format, so the dump is staged
 * as a file rather than piped. On a direct host that is the original path, over
 * SSH it is an upload that gets cleaned up afterwards.
 */
async function restoreSingleDatabase(
    sourcePath: string,
    targetDb: string,
    config: PostgresRestoreConfig,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const pgRestore = await host.which(...PG_RESTORE);
    const pass = config.privilegedAuth?.password || config.password;

    await host.stageInput(sourcePath, {}, async (stagedPath) => {
        const args = [
            ...buildConnectionArgs(config),
            "-d", targetDb,
            "-w",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
            "--no-comments",
            "--no-tablespaces",
            "--no-security-labels",
            "-v",
            stagedPath,
        ];

        log(`Restoring to database: ${targetDb}`, 'info', 'command', `${pgRestore} ${args.join(' ')}`);

        const result = await host.exec([pgRestore, ...args], { env: pgEnv(pass) });

        // pg_restore reports recoverable problems with exit code 1. Treating that
        // as a failure would reject restores that actually succeeded.
        if (result.code !== 0 && result.code !== 1) {
            const detail = result.stderr.trim() ? `. Error: ${result.stderr.trim()}` : "";
            throw new Error(`pg_restore exited with code ${result.code}${detail}`);
        }

        if (result.code === 1) {
            const warningsOnly = result.stderr.includes("warning") && result.stderr.includes("errors ignored");
            if (!warningsOnly) {
                throw new Error(`pg_restore exited with code 1. Error: ${result.stderr.trim()}`);
            }
            if (result.stderr.includes("transaction_timeout")) {
                log(
                    "Restore completed - pg_restore 18 sent SET transaction_timeout which is unsupported on PostgreSQL < 17. This is cosmetic and does not affect the restore.",
                    'warning',
                );
            } else {
                log('Restore completed with warnings (non-fatal)', 'warning');
            }
        }

        for (const line of `${result.stdout}\n${result.stderr}`.trim().split("\n")) {
            if (line && !line.includes("NOTICE:")) {
                log(line, 'info');
            }
        }
    });
}

/**
 * Capability export for combined DB+directory restores (JobSource): restores a single plain
 * dump file into a single target database. Thin wrapper around restoreSingleDatabase, the
 * same per-database logic restore() already uses internally for its own multi-DB case.
 * Unlike restore(), this does not create the target database - callers must ensure it exists
 * first (e.g. via prepareRestore).
 */
export async function restoreOne(
    config: PostgresRestoreConfig,
    filePath: string,
    targetDbName: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const env = { ...process.env };
    const priv = config.privilegedAuth;
    const user = (priv && priv.user) ? priv.user : config.user;
    const password = (priv && priv.password) ? priv.password : config.password;
    if (password) env.PGPASSWORD = password;
    const usageConfig = { ...config, user };
    await restoreSingleDatabase(filePath, targetDbName, usageConfig, _host, onLog ?? (() => {}));
}

// LEGACY-FORMAT(read): Restores backups written before the seekable archive, a single dump
// file or a TAR of dumps. New backups go through restoreOne(). Remove once those backups no
// longer need restoring.
export async function restore(
    config: PostgresRestoreConfig,
    sourcePath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    let tempDir: string | null = null;

    try {
        const env = { ...process.env };

        const priv = config.privilegedAuth;
        const user = (priv && priv.user) ? priv.user : config.user;
        const password = (priv && priv.password) ? priv.password : config.password;

        if (password) {
            env.PGPASSWORD = password;
        } else {
            log("No password provided for connection.", "warning");
        }

        log(`Prepared connection: ${user}@${config.host}:${config.port} (Privileged: ${!!priv})`, "info");

        const usageConfig = { ...config, user };

        const mapping = config.databaseMapping as Array<{
            originalName: string;
            targetName: string;
            selected: boolean;
        }> | undefined;

        const isTar = await isMultiDbTar(sourcePath);

        if (isTar) {
            // ===== TAR ARCHIVE RESTORE =====
            log('Detected Multi-DB TAR archive', 'info');

            tempDir = await createTempDir('pg-restore-');
            log(`Created temp directory: ${tempDir}`, 'info');

            // Build list of selected database names for selective extraction
            const selectedNames = mapping
                ? mapping.filter(m => m.selected).map(m => m.originalName)
                : [];

            const { manifest, files } = await extractSelectedDatabases(sourcePath, tempDir, selectedNames);
            log(`Extracted ${files.length} of ${manifest.databases.length} database dumps from TAR`, 'info');

            const totalDbs = manifest.databases.length;
            let processed = 0;

            for (const dbEntry of manifest.databases) {
                if (!shouldRestoreDatabase(dbEntry.name, mapping)) {
                    processed++;
                    continue;
                }

                const targetDb = getTargetDatabaseName(dbEntry.name, mapping);
                const dumpPath = path.join(tempDir, dbEntry.filename);

                log(`Restoring database: ${dbEntry.name} -> ${targetDb}`, 'info');

                await prepareRestore(usageConfig, [targetDb], _host);
                await restoreSingleDatabase(dumpPath, targetDb, usageConfig, _host, log);
                log(`Database ${targetDb} restored successfully`, 'success');

                processed++;
                if (onProgress) {
                    onProgress(Math.round((processed / totalDbs) * 100));
                }
            }

            log(`Multi-DB restore completed: ${processed}/${totalDbs} databases`, 'success');
        } else {
            // ===== SINGLE DATABASE RESTORE =====
            const isCustom = await isCustomFormat(sourcePath);
            log(`Detected backup format: ${isCustom ? 'Custom (binary)' : 'Plain SQL'}`, 'info');

            if (!isCustom) {
                throw new Error('Plain SQL format is no longer supported. Please use custom format (-Fc) backups.');
            }

            let targetDb: string;

            if (mapping && mapping.length > 0) {
                const selected = mapping.filter(m => m.selected);
                if (selected.length === 0) {
                    throw new Error("No databases selected for restore.");
                }
                if (selected.length > 1) {
                    throw new Error("Single-database backup cannot be restored to multiple databases.");
                }
                targetDb = selected[0].targetName || selected[0].originalName;
            } else {
                const db = Array.isArray(config.database) ? config.database[0] : config.database;
                targetDb = db || 'postgres';
            }

            log(`Restoring single database to: ${targetDb}`, 'info');

            await prepareRestore(usageConfig, [targetDb], _host);
            await restoreSingleDatabase(sourcePath, targetDb, usageConfig, _host, log);
        }

        return {
            success: true,
            logs,
            startedAt,
            completedAt: new Date(),
        };

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
    } finally {
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
