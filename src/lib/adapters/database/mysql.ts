import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { MySQLSchema } from "@/lib/adapters/definitions";
import { exec, spawn } from "child_process";
import fs from "fs/promises";
import { createReadStream } from "fs";
import readline from "readline";
import util from "util";

const execAsync = util.promisify(exec);

export const MySQLAdapter: DatabaseAdapter = {
    id: "mysql",
    type: "database",
    name: "MySQL / MariaDB",
    configSchema: MySQLSchema,

    async analyzeDump(sourcePath: string): Promise<string[]> {
        const dbs = new Set<string>();

        try {
            const fileStream = createReadStream(sourcePath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            // Scan file
            for await (const line of rl) {
                // 1. Look for USE statements (most reliable for multi-db context)
                // Matches: USE `dbname`;
                const useMatch = line.match(/^USE `([^`]+)`;/i);
                if (useMatch) {
                    dbs.add(useMatch[1]);
                }

                // 2. Look for CREATE DATABASE
                // Matches: CREATE DATABASE `foo` ...
                // Matches: CREATE DATABASE IF NOT EXISTS `foo` ...
                // Matches: CREATE DATABASE /*!32312 IF NOT EXISTS*/ `foo` ...
                // We use a broader regex: CREATE DATABASE [anything/comments] `name`
                const createMatch = line.match(/CREATE DATABASE .*?`([^`]+)`/i);
                if (createMatch) {
                    dbs.add(createMatch[1]);
                }

                // 3. Look for standard mysqldump comments
                // Matches: -- Current Database: `foo`
                const currentMatch = line.match(/-- Current Database: `([^`]+)`/i);
                if (currentMatch) {
                    dbs.add(currentMatch[1]);
                }
            }
        } catch (e) {
            console.error("Error analyzing MySQL dump:", e);
        }

        return Array.from(dbs);
    },

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
            // Check for explicit database mapping (Multi-DB Selective Restore)
            const dbMapping = config.databaseMapping as { originalName: string, targetName: string, selected: boolean }[] | undefined;
            const usePrivileged = !!config.privilegedAuth;
            const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
            const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

            if (dbMapping && dbMapping.length > 0) {
                // ADVANCED STREAMING RESTORE
                logs.push("Starting selective/renaming restore...");

                // 1. Ensure target databases exist
                const selectedDbs = dbMapping.filter(m => m.selected);
                for (const db of selectedDbs) {
                    const targetName = db.targetName || db.originalName;
                     const createCmd = `mysql -h ${config.host} -P ${config.port} -u ${creationUser} --protocol=tcp ${creationPass ? `-p"${creationPass}"` : ''} -e 'CREATE DATABASE IF NOT EXISTS \`${targetName}\`'`;
                     try {
                        await execAsync(createCmd);
                        logs.push(`Database '${targetName}' ensured.`);

                        if (usePrivileged) {
                             const grantCmd = `mysql -h ${config.host} -P ${config.port} -u ${creationUser} --protocol=tcp ${creationPass ? `-p"${creationPass}"` : ''} -e "GRANT ALL PRIVILEGES ON \\\`${targetName}\\\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \\\`${targetName}\\\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;"`;
                             await execAsync(grantCmd);
                             logs.push(`Permissions granted for '${targetName}'.`);
                        }
                     } catch(e: any) {
                         logs.push(`Warning ensures DB '${targetName}': ${e.message}`);
                     }
                }

                // 2. Stream and Transform
                return new Promise((resolve, reject) => {
                    const fileStream = createReadStream(sourcePath);
                    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                    // Spawn MySQL process
                    let mysqlCmd = `mysql -h ${config.host} -P ${config.port} -u ${config.user} --protocol=tcp`;
                    if (config.password) mysqlCmd += ` -p"${config.password}"`;

                    // Shell-quote or just use array for spawn? spawn is safer for passwords but we use exec style for now.
                    // Wait, piping to exec's stdin is hard if we use exec(command).
                    // Better to use spawn.
                    const args = [
                        '-h', config.host,
                        '-P', String(config.port),
                        '-u', config.user,
                        '--protocol=tcp'
                    ];
                    if(config.password) args.push(`-p${config.password}`);

                    const mysqlProc = spawn('mysql', args, { stdio: ['pipe', 'pipe', 'pipe'] });

                    mysqlProc.stderr.on('data', (d) => logs.push(`MySQL Stderr: ${d.toString()}`));
                    mysqlProc.on('error', (err) => reject({ success: false, logs, error: err.message, startedAt, completedAt: new Date() }));

                    mysqlProc.on('close', (code) => {
                        if (code === 0) {
                            resolve({ success: true, logs, startedAt, completedAt: new Date() });
                        } else {
                             resolve({ success: false, logs, error: `MySQL exited with code ${code}`, startedAt, completedAt: new Date() });
                        }
                    });

                    // Streaming Logic
                    let currentOriginalDb: string | null = null;
                    let skipCurrentSection = false;
                    let currentTargetName: string | null = null;

                    rl.on('line', (line) => {
                        // Detect DB context switch
                        // USE `foo`;
                        const useMatch = line.match(/^USE `([^`]+)`;/i);
                        if (useMatch) {
                            const dbName = useMatch[1];
                            currentOriginalDb = dbName;

                            // Check mapping
                            const map = dbMapping.find(m => m.originalName === dbName);
                            if (map) {
                                if (!map.selected) {
                                    skipCurrentSection = true;
                                    return; // Don't write this line
                                } else {
                                    skipCurrentSection = false;
                                    currentTargetName = map.targetName || map.originalName;
                                    // REWRITE the line
                                    mysqlProc.stdin.write(`USE \`${currentTargetName}\`;\n`);
                                    return;
                                }
                            } else {
                                // DB found in file but not in mapping? Default to Include or Skip?
                                // If we inspected file fully, it should be in mapping.
                                // If not, maybe just pass through?
                                skipCurrentSection = false;
                            }
                        }

                        // Also detect CREATE DATABASE `foo`
                        // We might want to filter these out if we created them manually above,
                        // OR rewrite them if we want the dump to do it.
                        // Since we pre-created them, we can probably just rewrite/skip.
                        const createMatch = line.match(/^CREATE DATABASE (?:IF NOT EXISTS )?`([^`]+)`/i);
                        if (createMatch) {
                            const dbName = createMatch[1];
                             const map = dbMapping.find(m => m.originalName === dbName);
                             if (map) {
                                 if (!map.selected) {
                                     // Skip this create statement and subsequent lines presumably?
                                     // Well, wait for USE to toggle skip flag?
                                     // Usually CREATE is followed by USE.
                                     // Let's just ignore CREATE statement itself if not selected.
                                     return;
                                 } else {
                                     // Rewrite
                                     const target = map.targetName || map.originalName;
                                     mysqlProc.stdin.write(`CREATE DATABASE IF NOT EXISTS \`${target}\`;\n`);
                                     return;
                                 }
                             }
                        }

                        if (!skipCurrentSection) {
                            mysqlProc.stdin.write(line + '\n');
                        }
                    });

                    rl.on('close', () => {
                        mysqlProc.stdin.end();
                    });
                });

            }

            // LEGACY / SINGLE DB FLOW (unchanged mostly)
            // Determine credentials for DB creation

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

