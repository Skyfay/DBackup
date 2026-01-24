import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { getDialect } from "./dialects";
import fs from "fs/promises";
import { spawn } from "child_process";
import { createWriteStream } from "fs";

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
        if(Array.isArray(config.database)) dbs = config.database;
        else if(config.database && config.database.includes(',')) dbs = config.database.split(',');
        else if(config.database) dbs = [config.database];

        // --- DIALECT INTEGRATION ---
        const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
        const args = dialect.getDumpArgs(config, dbs);

        const env = { ...process.env };
        if (config.password) {
            env.MYSQL_PWD = config.password;
        }

        const safeCmd = `mysqldump ${args.join(' ').replace(config.password || '___NONE___', '******')}`;
        log(`Running database dump`, 'info', 'command', safeCmd);

        // Use spawn for streaming output (Best Practice from Guide)
        const dumpProcess = spawn('mysqldump', args, { env });
        const writeStream = createWriteStream(destinationPath);

        dumpProcess.stdout.pipe(writeStream);

        dumpProcess.stderr.on('data', (data) => {
            log(data.toString().trim());
        });

        await new Promise<void>((resolve, reject) => {
            dumpProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`mysqldump exited with code ${code}`));
            });
            dumpProcess.on('error', (err) => reject(err));
            writeStream.on('error', (err: any) => reject(err));
        });

        // Verify dump file size
        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("Dump file is empty. Check logs/permissions.");
        }

        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        log(`Dump finished successfully. Size: ${sizeMB} MB`);

        return {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };

    } catch (error: any) {
        log(`Error: ${error.message}`);
        return {
            success: false,
            logs,
            error: error.message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
