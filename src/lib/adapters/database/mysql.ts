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
            const dbMapping = config.databaseMapping as { originalName: string, targetName: string, selected: boolean }[] | undefined;
            const usePrivileged = !!config.privilegedAuth;
            const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
            const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

            // Determine operation mode
            // Mode 1: Mapping (Advanced) -> Explicitly selective or renaming
            // Mode 2: Force Target (Simple) -> User specified a single target DB, we must dump everything there
            // Mode 3: Passive (Full/Auto) -> No specific target enforcement, let the dump dictate (e.g. multi-db restore without rename)

            // For now, if config.database is set, we treat it as "Target".
            // Ideally we'd know if it was overridden.
            // Assumption: If the user is using the "Simple Restore" UI, they picked a target source & optional database name.
            // If they provided a database name, they expect content to go there.

            // To ensure we don't break "Full Restore", we really need to know if the user INTENDED to override.
            // But let's assume if there is NO mapping, and there IS a config.database, we are in "Single Target" mode.
            // Most MySQL Adapters have a default DB (e.g. 'mysql' or 'app').
            // So config.database is almost ALWAYS set.
            // This makes it risky to always strip USE.

            // New Heuristic:
            // If config.database is set, AND the user didn't request a mapping, we typically just run `mysql db < file`.
            // As we saw, this fails for Multi-DB dumps attempting to target a specific DB.
            // So we will implement a Stream Processor that strips USE/CREATE DATABASE *only if* we are ignoring the dump's structure.

            // Let's implement a universal Stream Restore that covers all cases.

            // Pre-Ensure Target DB(s)
            if (dbMapping && dbMapping.length > 0) {
                 const selectedDbs = dbMapping.filter(m => m.selected);
                 for (const db of selectedDbs) {
                    const targetName = db.targetName || db.originalName;
                    await this.ensureDatabase(config, targetName, creationUser, creationPass, usePrivileged, logs);
                 }
            } else if (config.database) {
                // Ensure the single target database exists
                await this.ensureDatabase(config, config.database, creationUser, creationPass, usePrivileged, logs);
            }

            return new Promise((resolve, reject) => {
                const args = [
                    '-h', config.host,
                    '-P', String(config.port),
                    '-u', config.user,
                    '--protocol=tcp'
                ];
                if(config.password) args.push(`-p${config.password}`);

                // If we are in "Single Target" mode, we connect directly to that DB
                const singleTargetDb = (!dbMapping || dbMapping.length === 0) && config.database ? config.database : null;
                if (singleTargetDb) {
                     args.push(singleTargetDb);
                }

                const mysqlProc = spawn('mysql', args, { stdio: ['pipe', 'pipe', 'pipe'] });

                mysqlProc.stderr.on('data', (d) => {
                    const msg = d.toString();
                    if (!msg.includes("Using a password")) logs.push(`MySQL: ${msg}`);
                });

                mysqlProc.on('error', (err) => reject({ success: false, logs, error: err.message, startedAt, completedAt: new Date() }));
                mysqlProc.on('close', (code) => {
                    if (code === 0) {
                        resolve({ success: true, logs, startedAt, completedAt: new Date() });
                    } else {
                        resolve({ success: false, logs, error: `MySQL exited with code ${code}`, startedAt, completedAt: new Date() });
                    }
                });

                const fileStream = createReadStream(sourcePath);
                const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                let skipCurrentSection = false;
                let currentTargetName: string | null = null;

                rl.on('line', (line) => {
                    // 1. Handle "Use" statements
                    const useMatch = line.match(/^USE `([^`]+)`;/i);
                    if (useMatch) {
                        const originalDb = useMatch[1];

                        if (dbMapping) {
                            const map = dbMapping.find(m => m.originalName === originalDb);
                             if (map) {
                                if (!map.selected) {
                                    skipCurrentSection = true;
                                    return;
                                }
                                skipCurrentSection = false;
                                currentTargetName = map.targetName || map.originalName;
                                mysqlProc.stdin.write(`USE \`${currentTargetName}\`;\n`);
                                return;
                            } else {
                                // Not in mapping? If we are doing selective restore, we might skip or default.
                                // Let's default to skip if mapping implies exclusivity, otherwise pass.
                                // Actually user selects checks. Unchecked are in the list with selected=false.
                                // If it's missing entirely (new db?), pass through?
                                skipCurrentSection = false;
                            }
                        } else if (singleTargetDb) {
                            // Single Target Mode: We want to FORCE everything into singleTargetDb.
                            // So we IGNORE the USE statement to prevent switching away.
                            logs.push(`Ignoring 'USE ${originalDb}' to enforce target '${singleTargetDb}'`);
                            return;
                        }
                    }

                    // 2. Handle "Create Database" statements
                    const createMatch = line.match(/^CREATE DATABASE (?:IF NOT EXISTS )?`([^`]+)`/i);
                    if (createMatch) {
                        const originalDb = createMatch[1];

                        if (dbMapping) {
                             const map = dbMapping.find(m => m.originalName === originalDb);
                             if (map && !map.selected) return;
                             // Rewriting handled by pre-ensure + USE switch, but if we want to allow Creates:
                             // We already pre-created. So we can skip.
                             return;
                        } else if (singleTargetDb) {
                            // Single Target Mode: Ignore Create DB (we already ensured target exists)
                            return;
                        }
                    }

                    // 3. Write line if not skipped
                    if (!skipCurrentSection) {
                        mysqlProc.stdin.write(line + '\n');
                    }
                });

                rl.on('close', () => {
                    logs.push(`Stream finished.`);
                    mysqlProc.stdin.end();
                });
            });

        } catch (error: any) {
             const msg = error.message || "";
             logs.push(`Error: ${msg}`);
             return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
        }
    },

    async ensureDatabase(config: any, dbName: string, user: string, pass: string | undefined, privileged: boolean, logs: string[]) {
         const createCmd = `mysql -h ${config.host} -P ${config.port} -u ${user} --protocol=tcp ${pass ? `-p"${pass}"` : ''} -e 'CREATE DATABASE IF NOT EXISTS \`${dbName}\`'`;
         try {
            await execAsync(createCmd);
            logs.push(`Database '${dbName}' ensured.`);
            if (privileged) {
                 const grantCmd = `mysql -h ${config.host} -P ${config.port} -u ${user} --protocol=tcp ${pass ? `-p"${pass}"` : ''} -e "GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;"`;
                 await execAsync(grantCmd);
                 logs.push(`Permissions granted for '${dbName}'.`);
            }
         } catch(e: any) {
             logs.push(`Warning ensures DB '${dbName}': ${e.message}`);
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

