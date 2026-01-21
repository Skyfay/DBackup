import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import { waitForProcess } from "@/lib/adapters/process";

export async function dump(config: any, destinationPath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
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

        // Case 1: Single Database (Stream directly)
        if (dbs.length <= 1) {
            const args = dialect.getDumpArgs(config, dbs);
            log(`Starting dump process`, 'info', 'command', `pg_dump ${args.join(' ')}`);

            const dumpProcess = spawn('pg_dump', args, { env });
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
        // Case 2: Multiple Databases (Pipe output sequentially)
        else {
            log(`Dumping multiple databases: ${dbs.join(', ')}`);
            const writeStream = createWriteStream(destinationPath);

            for (const db of dbs) {
                log(`Starting dump for ${db}...`);
                const args = dialect.getDumpArgs(config, [db]);

                // Inject --create if not present
                if (!args.includes('--create')) args.push('--create');

                log(`Running dump command`, 'info', 'command', `pg_dump ${args.join(' ')}`);
                const child = spawn('pg_dump', args, { env });

                // Pipe stdout to file, but don't close the stream when this child exits
                child.stdout.pipe(writeStream, { end: false });

                // Use shared process monitor
                await waitForProcess(child, `pg_dump for ${db}`, (msg) => log(`[${db}] ${msg}`));

                log(`Completed dump for ${db}`, 'success');
            }

            writeStream.end();
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
