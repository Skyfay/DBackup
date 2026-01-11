import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { MySQLSchema } from "@/lib/adapters/definitions";
import { exec } from "child_process";
import fs from "fs/promises";
import util from "util";

const execAsync = util.promisify(exec);

export const MySQLAdapter: DatabaseAdapter = {
    id: "mysql",
    type: "database",
    name: "MySQL / MariaDB",
    configSchema: MySQLSchema,

    async dump(config: any, destinationPath: string): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

        try {
            // Construct command
            // Note: Password handling in command line is insecure, better to use config file or env var
            // but for this MVP we'll construct it carefully.

            let command = `mysqldump -h ${config.host} -P ${config.port} -u ${config.user}`;

            if (config.password) {
                command += ` -p"${config.password}"`;
            }

            if (config.options) {
                command += ` ${config.options}`;
            }

            command += ` ${config.database} > "${destinationPath}"`;

            logs.push(`Executing command: ${command.replace(/-p"[^"]*"/, '-p"*****"')}`);

            const { stdout, stderr } = await execAsync(command);

            if (stderr) {
                logs.push(`stderr: ${stderr}`);
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
            logs.push(`Error: ${error.message}`);
            return {
                success: false,
                logs,
                error: error.message,
                startedAt,
                completedAt: new Date(),
            };
        }
    },

    async restore(config: any, sourcePath: string): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

        try {
             let command = `mysql -h ${config.host} -P ${config.port} -u ${config.user}`;

            if (config.password) {
                command += ` -p"${config.password}"`;
            }

            command += ` ${config.database} < "${sourcePath}"`;

            logs.push(`Executing restore command: ${command.replace(/-p"[^"]*"/, '-p"*****"')}`);

            const { stdout, stderr } = await execAsync(command);
             if (stderr) {
                logs.push(`stderr: ${stderr}`);
            }

            return {
                success: true,
                logs,
                startedAt,
                completedAt: new Date(),
            };

        } catch (error: any) {
             logs.push(`Error: ${error.message}`);
            return {
                success: false,
                logs,
                error: error.message,
                startedAt,
                completedAt: new Date(),
            };
        }
    }
}
