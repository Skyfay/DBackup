import type { ExecutionHost } from "@/lib/transport";
import { MONGODUMP, buildConnectionArgs, maskSecrets } from "./args";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import fs from "fs/promises";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import { getDatabases } from "./connection";

/**
 * Extended MongoDB config for dump operations with runtime fields
 */
type MongoDBDumpConfig = MongoDBConfig & {
    detectedVersion?: string;
};

/**
 * Dump a single MongoDB database with mongodump --archive --gzip.
 *
 * mongodump writes the archive to a path, so the destination is requested from
 * the transport: on a direct host that is the final file, over SSH it is a
 * remote temp file whose bytes are fetched and cleaned up afterwards. The SSH
 * path used to ask for --archive on stdout and stream it back instead.
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: MongoDBDumpConfig,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const mongodump = await host.which(...MONGODUMP);

    await host.captureOutput(outputPath, {}, async (hostPath) => {
        const args = [
            ...buildConnectionArgs(config),
            "--db", dbName,
            `--archive=${hostPath}`,
            "--gzip",
        ];

        if (config.options) {
            args.push(...parseOptionString(config.options));
        }

        log(`Dumping database: ${dbName}`, "info", "command", `${mongodump} ${maskSecrets(args, config.password)}`);

        const proc = await host.spawn([mongodump, ...args]);
        proc.stdout.on("data", () => { /* mongodump writes progress to stderr */ });
        proc.stderr.on("data", (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) log(`[mongodump] ${msg}`, "info");
        });

        const { code, signal } = await proc.exit();
        if (code !== 0) {
            throw new Error(
                `mongodump exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`,
            );
        }
    });
}

/** Split a user-supplied option string, honouring single and double quotes. */
function parseOptionString(options: string): string[] {
    const parts = options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
    return parts.map((part) => {
        if (part.startsWith('"') && part.endsWith('"')) return part.slice(1, -1);
        if (part.startsWith("'") && part.endsWith("'")) return part.slice(1, -1);
        return part;
    });
}

/**
 * Capability export for combined DB+directory backups (JobSource): dumps exactly one
 * database to a plain file, without any TAR/manifest wrapping. Thin wrapper around the
 * same per-database logic dump() already uses internally for its own multi-DB case.
 */
export async function dumpOne(
    config: MongoDBDumpConfig,
    dbName: string,
    destinationPath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    await dumpSingleDatabase(dbName, destinationPath, config, _host, onLog ?? (() => {}));
    const stats = await fs.stat(destinationPath);
    return { size: stats.size };
}

// LEGACY-FORMAT(write): Writes a backup in the format used before the seekable archive.
// No job calls it anymore, only tests do. Remove it together with DatabaseAdapter.dump.
export async function dump(
    config: MongoDBDumpConfig,
    destinationPath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    let tempDir: string | null = null;

    try {
        // Prepare DB list
        let dbs: string[] = [];
        if (Array.isArray(config.database)) {
            dbs = config.database;
        } else if (typeof config.database === 'string') {
            dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        // Fallback: if dbs is still empty but config.database exists
        if (dbs.length === 0 && config.database) {
            const db = Array.isArray(config.database) ? config.database[0] : config.database;
            if (db) dbs = [db];
        }

        // Discover all databases if none selected (same pattern as MySQL adapter)
        if (dbs.length === 0) {
            log("No databases selected - backing up all databases");
            try {
                dbs = await getDatabases(config, _host);
                log(`Found ${dbs.length} database(s): ${dbs.join(', ')}`);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                log(`Warning: Could not fetch database list: ${message}`, 'warning');
                // Continue anyway - mongodump without --db dumps all databases
            }
        }

        // Case 1: Single Database or ALL - Direct archive dump
        if (dbs.length <= 1) {
            log(`Starting single-database dump (archive format)`, 'info');
            await dumpSingleDatabase(dbs[0] || '', destinationPath, config, _host, log);
        }
        // Case 2: Multiple Databases - TAR archive with individual mongodump per DB
        else {
            log(`Dumping ${dbs.length} databases using TAR archive: ${dbs.join(', ')}`, 'info');

            tempDir = await createTempDir('mongo-multidb-');
            log(`Created temp directory: ${tempDir}`, 'info');

            const tarFiles: TarFileEntry[] = [];

            for (const dbName of dbs) {
                const dumpFilename = `${dbName}.archive`;
                const dumpPath = path.join(tempDir, dumpFilename);

                await dumpSingleDatabase(dbName, dumpPath, config, _host, log);
                log(`Database ${dbName} dumped successfully`, 'success');

                tarFiles.push({
                    name: dumpFilename,
                    path: dumpPath,
                    dbName,
                    format: 'archive',
                });
            }

            // Create TAR archive with manifest
            log(`Creating TAR archive with ${tarFiles.length} databases...`, 'info');
            const manifest: TarManifest = await createMultiDbTar(tarFiles, destinationPath, {
                sourceType: 'mongodb',
                engineVersion: config.detectedVersion || 'unknown',
            });

            log(`Multi-database TAR archive created successfully`, 'success');
            log(`Manifest: ${manifest.databases.length} databases, ${manifest.totalSize} bytes`, 'info');
        }

        // Verify
        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("Dump file is empty. Check logs/permissions.");
        }

        return {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Not logged here: the caller turns this into a thrown
        // `Dump failed: <message>` that the runner reports. Logging it
        // too put the same failure in the run log twice, which the
        // other database adapters never did.
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
