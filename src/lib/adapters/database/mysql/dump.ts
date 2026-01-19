import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import fs from "fs/promises";

export async function dump(config: any, destinationPath: string, onLog?: (msg: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        // Determine databases to backup
        let dbs: string[] = [];
        if(Array.isArray(config.database)) dbs = config.database;
        else if(config.database && config.database.includes(',')) dbs = config.database.split(',');
        else if(config.database) dbs = [config.database];

        const args: string[] = [
            '-h', config.host,
            '-P', String(config.port),
            '-u', config.user,
            '--protocol=tcp'
        ];

        if (config.disableSsl) {
            args.push('--skip-ssl');
        }

        const env = { ...process.env };
        if (config.password) {
            env.MYSQL_PWD = config.password;
        }

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

        if (dbs.length > 1) {
            args.push('--databases', ...dbs);
        } else if (dbs.length === 1) {
            args.push(dbs[0]);
        }

        args.push(`--result-file=${destinationPath}`);

        // No password in args anymore
        log(`Executing command: mysqldump ${args.join(' ')}`);

        const { stdout, stderr } = await execFileAsync('mysqldump', args, { env });

        if (stderr) {
            log(`stderr: ${stderr}`);
        }

        // Check file size
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
