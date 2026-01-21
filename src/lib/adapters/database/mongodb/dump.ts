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
        // Prepare DB list
         let dbs: string[] = [];
        if (Array.isArray(config.database)) {
            dbs = config.database;
        } else if (typeof config.database === 'string') {
            dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        if (dbs.length === 0 && config.database) dbs = [config.database];

        const dialect = getDialect('mongodb', config.detectedVersion);

        // Mongo dump logic with Dialect integration
        // Note: Dialect handles --archive flag which streams to stdout if no path given.

        const targetDbs = (dbs.length > 0) ? [dbs[0]] : [];
        if (dbs.length > 1) {
             log(`Warning: Multiple databases selected but mongodump archive only supports one or all. Dumping '${dbs[0]}' only.`);
        }

        const args = dialect.getDumpArgs(config, targetDbs);

        // Mask password in logs
        // Note: Dialect returns args array. We log it safely.
        // Simple masking for standard args. URI masking is harder but Dialect should handle it?
        // Or we just do generic masking.
        const logArgs = args.map(arg => {
            if(arg.startsWith('--password')) return '--password=******';
            if(arg.startsWith('mongodb')) return 'mongodb://...'; // simple mask
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
