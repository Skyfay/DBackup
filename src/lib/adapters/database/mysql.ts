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
            // Determine databases to backup
            let dbs: string[] = [];
            if(Array.isArray(config.database)) dbs = config.database;
            else if(config.database && config.database.includes(',')) dbs = config.database.split(',');
            else if(config.database) dbs = [config.database];

            let command = `mysqldump -h ${config.host} -P ${config.port} -u ${config.user} --protocol=tcp`;

            if (config.password) {
                command += ` -p"${config.password}"`;
            }

            if (config.options) {
                command += ` ${config.options}`;
            }

            if (dbs.length > 1) {
                command += ` --databases ${dbs.join(' ')}`;
            } else if (dbs.length === 1) {
                command += ` ${dbs[0]}`;
            }

            command += ` > "${destinationPath}"`;

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
            // Determine credentials for DB creation
            // If privilegedAuth is provided, use it. Otherwise use standard config.
            const usePrivileged = !!config.privilegedAuth;
            const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
            const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

            // Handle multiple databases (check if array or comma string)
            let dbs: string[] = [];
            if (Array.isArray(config.database)) {
                dbs = config.database;
            } else if (typeof config.database === 'string') {
                dbs = config.database.split(',').map((s: string) => s.trim());
            } else if (config.database) {
                dbs = [String(config.database)];
            }

            const isMultiDb = dbs.length > 1;

            if (isMultiDb) {
                 logs.push(`Multi-database restore detected (${dbs.join(', ')}). Skipping explicit CREATE DATABASE check (assuming dump handles it).`);
                 // If using privileged user, we try to grant permissions for ALL databases
                 if (usePrivileged) {
                    for (const dbName of dbs) {
                        try {
                             logs.push(`Granting permissions for '${dbName}'...`);
                             const grantCmd = `mysql -h ${config.host} -P ${config.port} -u ${creationUser} --protocol=tcp ${creationPass ? `-p"${creationPass}"` : ''} -e "GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;"`;
                             await execAsync(grantCmd);
                             logs.push(`Permissions granted for '${dbName}'.`);
                        } catch (grantErr: any) {
                             logs.push(`Warning: Failed to grant permissions for '${dbName}': ${grantErr.message}`);
                        }
                    }
                 }
            } else {
                // SINGLE DB Logic: Ensure database exists before restoring
                const createCmd = `mysql -h ${config.host} -P ${config.port} -u ${creationUser} --protocol=tcp ${creationPass ? `-p"${creationPass}"` : ''} -e 'CREATE DATABASE IF NOT EXISTS \`${config.database}\`'`;

                try {
                    // Log simplified command to hide password
                    logs.push(`Attempting to ensure database '${config.database}' exists (User: ${creationUser})...`);
                    await execAsync(createCmd);
                    logs.push(`Database '${config.database}' ensured successfully.`);

                    // If we used a privileged user, we MUST grant permissions to the original user
                    if (usePrivileged) {
                        logs.push(`Granting permissions to '${config.user}'...`);
                        // Grant for local and wildcard host to be safe
                        // Escaping backticks with backslash to prevent shell execution
                        const grantCmd = `mysql -h ${config.host} -P ${config.port} -u ${creationUser} --protocol=tcp ${creationPass ? `-p"${creationPass}"` : ''} -e "GRANT ALL PRIVILEGES ON \\\`${config.database}\\\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \\\`${config.database}\\\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;"`;
                        try {
                            await execAsync(grantCmd);
                            logs.push(`Permissions granted to '${config.user}'.`);
                        } catch (grantErr: any) {
                            logs.push(`Warning: Failed to grant permissions: ${grantErr.message}`);
                        }
                    }

                } catch (e: any) {
                    // Try to extract the specific MySQL error message
                    const msg = e.message || "";
                    const match = msg.match(/ERROR \d+.*$/m);
                    const cleanError = match ? match[0] : msg;
                    logs.push(`Warning: Failed to create/ensure database '${config.database}': ${cleanError}`);
                }
            }

             // Add --protocol=tcp to avoid socket issues on localhost
             let command = `mysql -h ${config.host} -P ${config.port} -u ${config.user} --protocol=tcp`;

            if (config.password) {
                command += ` -p"${config.password}"`;
            }

            // Only append database name if it's a single DB restore
            if (!isMultiDb) {
                command += ` ${config.database}`;
            }

            command += ` < "${sourcePath}"`;

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
            // Clean up error message
            const msg = error.message || "";
            const match = msg.match(/ERROR \d+.*$/m);
            const cleanError = match ? match[0] : msg;

            logs.push(`Error: ${cleanError}`);

            return {
                success: false,
                logs,
                error: cleanError,
                startedAt,
                completedAt: new Date(),
            };
        }
    },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            // Force protocol=tcp to ensure we connect via network port (vital for Docker on localhost)
            let command = `mysqladmin ping -h ${config.host} -P ${config.port} -u ${config.user} --protocol=tcp --connect-timeout=5`;
             if (config.password) {
                // Using MYSQL_PWD env var logic relative to exec might be safer but inline works for MVP
                command += ` -p"${config.password}"`;
            }

            await execAsync(command);
            return { success: true, message: "Connection successful" };
        } catch (error: any) {
            return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
        }
    },

    async getDatabases(config: any): Promise<string[]> {
        const command = `mysql -h ${config.host} -P ${config.port} -u ${config.user} ${config.password ? `-p"${config.password}"` : ''} --protocol=tcp -e "SHOW DATABASES" --skip-column-names`;
        const { stdout } = await execAsync(command);
        const sysDbs = ['information_schema', 'mysql', 'performance_schema', 'sys'];
        return stdout.split('\n').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
    }
};

