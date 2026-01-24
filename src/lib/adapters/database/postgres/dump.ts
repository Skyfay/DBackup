import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { getPostgresBinary } from "./version-utils";

export async function dump(config: any, destinationPath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, _onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

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

        // Case 1: Single Database - Use pg_dump with custom format
        if (dbs.length <= 1) {
            const args = dialect.getDumpArgs(config, dbs);

            // Use version-matched pg_dump binary
            const pgDumpBinary = await getPostgresBinary('pg_dump', config.detectedVersion);
            log(`Starting single-database dump (custom format)`, 'info', 'command', `${pgDumpBinary} ${args.join(' ')}`);
            log(`Using ${pgDumpBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

            const dumpProcess = spawn(pgDumpBinary, args, { env });
            const writeStream = createWriteStream(destinationPath);

            dumpProcess.stdout.pipe(writeStream);

            dumpProcess.stderr.on('data', (data) => {
                 log(data.toString().trim());
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
        // Case 2: Multiple Databases - Use pg_dumpall for plain SQL
        else {
            log(`Dumping multiple databases using pg_dumpall: ${dbs.join(', ')}`, 'info');
            log(`Note: Using plain SQL format for multi-database support`, 'info');

            const args = dialect.getDumpArgs(config, dbs);

            // Use version-matched pg_dumpall binary
            const pgDumpBinary = await getPostgresBinary('pg_dump', config.detectedVersion);
            const pgDumpallBinary = pgDumpBinary.replace('pg_dump', 'pg_dumpall');

            log(`Starting multi-database dump`, 'info', 'command', `${pgDumpallBinary} ${args.join(' ')}`);
            log(`Using ${pgDumpallBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

            const dumpProcess = spawn(pgDumpallBinary, args, { env });
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
                    if (code === 0) {
                        log('Multi-database dump completed successfully', 'success');
                        resolve();
                    } else {
                        reject(new Error(`pg_dumpall exited with code ${code}`));
                    }
                });
                dumpProcess.on('error', (err) => reject(err));
                writeStream.on('error', (err) => reject(err));
            });
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

    } catch (error: any) {
        log(`Dump failed: ${error.message}`);
        return {
            success: false,
            logs,
            error: error.message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
