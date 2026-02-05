import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { getPostgresBinary } from "./version-utils";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";

/**
 * Dump a single PostgreSQL database using pg_dump with custom format (-Fc)
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: any,
    env: NodeJS.ProcessEnv,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const pgDumpBinary = await getPostgresBinary('pg_dump', config.detectedVersion);

    const args = [
        '-h', config.host,
        '-p', String(config.port),
        '-U', config.user,
        '-F', 'c', // Custom format (compressed, binary)
        '-Z', '6', // Compression level
        '-d', dbName,
    ];

    // Add custom options if provided
    if (config.options) {
        const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
        for (const part of parts) {
            if (part.startsWith('"') && part.endsWith('"')) {
                args.push(part.slice(1, -1));
            } else if (part.startsWith("'") && part.endsWith("'")) {
                args.push(part.slice(1, -1));
            } else {
                args.push(part);
            }
        }
    }

    log(`Dumping database: ${dbName}`, 'info', 'command', `${pgDumpBinary} ${args.join(' ')}`);

    const dumpProcess = spawn(pgDumpBinary, args, { env });
    const writeStream = createWriteStream(outputPath);

    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('NOTICE:')) {
            log(msg, 'info');
        }
    });

    await new Promise<void>((resolve, reject) => {
        dumpProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pg_dump for ${dbName} exited with code ${code}`));
        });
        dumpProcess.on('error', (err) => reject(err));
        writeStream.on('error', (err) => reject(err));
    });
}

export async function dump(
    config: any,
    destinationPath: string,
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
        const env = { ...process.env };
        if (config.password) {
            env.PGPASSWORD = config.password;
        }

        // Determine databases
        let dbs: string[] = [];
        if (Array.isArray(config.database)) {
            dbs = config.database;
        } else if (typeof config.database === 'string') {
            dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        if (dbs.length === 0 && config.database) dbs = [config.database];

        const dialect = getDialect('postgres', config.detectedVersion);
        const pgDumpBinary = await getPostgresBinary('pg_dump', config.detectedVersion);
        log(`Using ${pgDumpBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

        // Case 1: Single Database - Direct dump with custom format
        if (dbs.length <= 1) {
            const args = dialect.getDumpArgs(config, dbs);

            log(`Starting single-database dump (custom format)`, 'info', 'command', `${pgDumpBinary} ${args.join(' ')}`);

            const dumpProcess = spawn(pgDumpBinary, args, { env });
            const writeStream = createWriteStream(destinationPath);

            dumpProcess.stdout.pipe(writeStream);

            dumpProcess.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg && !msg.includes('NOTICE:')) {
                    log(msg, 'info');
                }
            });

            await new Promise<void>((resolve, reject) => {
                dumpProcess.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`pg_dump exited with code ${code}`));
                });
                dumpProcess.on('error', (err) => reject(err));
                writeStream.on('error', (err) => reject(err));
            });
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

                await dumpSingleDatabase(dbName, dumpPath, config, env, log);
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
        log(`Dump failed: ${message}`, 'error');
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
