import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { waitForProcess } from "@/lib/adapters/process";
import fs from "fs/promises";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";

/**
 * Dump a single MongoDB database using mongodump --archive --gzip
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: any,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const dialect = getDialect('mongodb', config.detectedVersion);

    // Get base args but override to dump specific DB to file
    const args: string[] = [];

    if (config.uri) {
        args.push(`--uri=${config.uri}`);
    } else {
        args.push('--host', config.host);
        args.push('--port', String(config.port));

        if (config.user && config.password) {
            args.push('--username', config.user);
            args.push('--password', config.password);
            args.push('--authenticationDatabase', config.authenticationDatabase || 'admin');
        }
    }

    args.push('--db', dbName);
    args.push(`--archive=${outputPath}`);
    args.push('--gzip');

    // Add custom options
    if (config.options) {
        const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
        for (const part of parts) {
            if (part.startsWith('"') && part.endsWith('"')) args.push(part.slice(1, -1));
            else if (part.startsWith("'") && part.endsWith("'")) args.push(part.slice(1, -1));
            else args.push(part);
        }
    }

    // Mask password in logs
    const logArgs = args.map(arg => {
        if (arg.startsWith('--password')) return '--password=******';
        if (arg.startsWith('mongodb')) return 'mongodb://...';
        return arg;
    });

    log(`Dumping database: ${dbName}`, 'info', 'command', `mongodump ${logArgs.join(' ')}`);

    const dumpProcess = spawn('mongodump', args);

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) log(msg, 'info');
    });

    await waitForProcess(dumpProcess, 'mongodump');
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
        // Prepare DB list
        let dbs: string[] = [];
        if (Array.isArray(config.database)) {
            dbs = config.database;
        } else if (typeof config.database === 'string') {
            dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        if (dbs.length === 0 && config.database) dbs = [config.database];

        const dialect = getDialect('mongodb', config.detectedVersion);

        // Case 1: Single Database or ALL - Direct archive dump
        if (dbs.length <= 1) {
            const args = dialect.getDumpArgs(config, dbs);

            // Mask password in logs
            const logArgs = args.map(arg => {
                if (arg.startsWith('--password')) return '--password=******';
                if (arg.startsWith('mongodb')) return 'mongodb://...';
                return arg;
            });

            log(`Running mongo dump`, 'info', 'command', `mongodump ${logArgs.join(' ')}`);

            const dumpProcess = spawn('mongodump', args);
            const writeStream = createWriteStream(destinationPath);

            dumpProcess.stdout.pipe(writeStream);

            dumpProcess.stderr.on('data', (data) => {
                log(data.toString().trim());
            });

            await waitForProcess(dumpProcess, 'mongodump');
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

                await dumpSingleDatabase(dbName, dumpPath, config, log);
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

    } catch (error: any) {
        log(`Dump failed: ${error.message}`, 'error');
        return {
            success: false,
            logs,
            error: error.message,
            startedAt,
            completedAt: new Date(),
        };
    } finally {
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
