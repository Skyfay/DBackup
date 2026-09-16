import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";
import { awaitDumpProcess } from "../common/dump-process";
import { PostgresConfig } from "@/lib/adapters/definitions";
import { getDatabases } from "./connection";
import { PG_DUMP, buildConnectionArgs, pgEnv } from "./args";

/**
 * Extended PostgreSQL config for dump operations with runtime fields
 */
type PostgresDumpConfig = PostgresConfig & {
    detectedVersion?: string;
    pgCompression?: string;
};

/**
 * Builds the -Z flag arguments for pg_dump based on the pgCompression job setting.
 *
 * pgCompression values:
 *   ""        - legacy behavior: -Z 6 (gzip level 6, all pg versions)
 *   "NONE"    - no compression: -Z 0
 *   "GZIP:N"  - gzip level N (numeric syntax, all pg versions)
 *   "LZ4:N"   - lz4 level N (requires pg14+)
 *   "ZSTD:N"  - zstd level N (requires pg16+)
 */
function buildCompressionArgs(pgCompression: string | undefined): string[] {
    if (!pgCompression || pgCompression === "") {
        // Legacy: keep original behavior for existing jobs
        return ["-Z", "6"];
    }
    if (pgCompression === "NONE") {
        return ["-Z", "0"];
    }
    const colonIdx = pgCompression.indexOf(":");
    if (colonIdx === -1) return ["-Z", "6"];
    const algo = pgCompression.slice(0, colonIdx).toUpperCase();
    const level = pgCompression.slice(colonIdx + 1);
    if (algo === "GZIP") {
        // Use numeric syntax for broadest pg version compatibility
        return ["-Z", level];
    }
    if (algo === "LZ4") {
        return ["-Z", `lz4:${level}`];
    }
    if (algo === "ZSTD") {
        return ["-Z", `zstd:${level}`];
    }
    // Unknown algo - fall back to legacy
    return ["-Z", "6"];
}

/**
 * Dump a single PostgreSQL database using pg_dump with custom format (-Fc).
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: PostgresDumpConfig,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const pgDump = await host.which(...PG_DUMP);

    const args = [
        ...buildConnectionArgs(config),
        "-F", "c", // Custom format (compressed, binary)
        ...buildCompressionArgs(config.pgCompression),
        "-d", dbName,
    ];

    if (config.options) {
        args.push(...parseOptionString(config.options));
    }

    log(`Dumping database: ${dbName}`, 'info', 'command', `${pgDump} ${args.join(' ')}`);

    // pg_dump writes to stdout, and a host process delivers stdout to this
    // machine whatever the transport is. The bytes are already local, so they
    // are written straight to the destination. captureOutput would name a path
    // on the remote host and then write it with the local fs, which happens to
    // work in direct mode because the two are the same path, and fails over
    // SSH with "No such file" on the download.
    const proc = await host.spawn([pgDump, ...args], { env: pgEnv(config.password) });
    const writeStream = createWriteStream(outputPath);

    proc.stdout.pipe(writeStream);
    proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('NOTICE:')) {
            log(msg, 'info');
        }
    });

    await awaitDumpProcess(proc, writeStream, `pg_dump for ${dbName}`);

    // Custom format always starts with a PGDMP header, so an empty file can
    // only mean pg_dump wrote nothing. Second line of defence behind the exit
    // code, for the case where the tool reports success anyway.
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) {
        throw new Error(`Dump file for ${dbName} is empty. Check logs/permissions.`);
    }
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
    config: PostgresDumpConfig,
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
    config: PostgresDumpConfig,
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
        // Determine databases
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

        // Auto-discover all databases if none specified
        if (dbs.length === 0) {
            log("No DB selected - auto-discovering all databases…", "info");
            dbs = await getDatabases(config, _host);
            log(`Discovered ${dbs.length} database(s): ${dbs.join(", ")}`, "info");
            if (dbs.length === 0) {
                throw new Error("No databases found on the server");
            }
        }

        // Case 1: Single Database - Direct dump with custom format
        if (dbs.length <= 1) {
            log(`Starting single-database dump (custom format)`, 'info');
            await dumpSingleDatabase(dbs[0], destinationPath, config, _host, log);
        }
        // Case 2: Multiple Databases - TAR archive with individual pg_dump per DB
        else {
            log(`Dumping ${dbs.length} databases using TAR archive: ${dbs.join(', ')}`, 'info');

            // Create temp directory for individual dumps
            tempDir = await createTempDir('pg-multidb-');
            log(`Created temp directory: ${tempDir}`, 'info');

            const tarFiles: TarFileEntry[] = [];

            // Dump each database individually with custom format
            for (const dbName of dbs) {
                const dumpFilename = `${dbName}.dump`;
                const dumpPath = path.join(tempDir, dumpFilename);

                await dumpSingleDatabase(dbName, dumpPath, config, _host, log);
                log(`Database ${dbName} dumped successfully`, 'success');

                tarFiles.push({
                    name: dumpFilename,
                    path: dumpPath,
                    dbName,
                    format: 'custom', // PostgreSQL custom format
                });
            }

            // Create TAR archive with manifest
            log(`Creating TAR archive with ${tarFiles.length} databases...`, 'info');
            const manifest: TarManifest = await createMultiDbTar(tarFiles, destinationPath, {
                sourceType: 'postgres',
                engineVersion: config.detectedVersion || 'unknown',
            });

            log(`Multi-database TAR archive created successfully`, 'success');
            log(`Manifest: ${manifest.databases.length} databases, ${manifest.totalSize} bytes`, 'info');
        }

        const stats = await fs.stat(destinationPath);

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
        // Cleanup temp directory
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
