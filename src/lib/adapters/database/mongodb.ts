import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { MongoDBSchema } from "@/lib/adapters/definitions";
import { execFile } from "child_process";
import fs from "fs/promises";
import util from "util";

const execFileAsync = util.promisify(execFile);

export const MongoDBAdapter: DatabaseAdapter = {
    id: "mongodb",
    type: "database",
    name: "MongoDB",
    configSchema: MongoDBSchema,

    async prepareRestore(config: any, databases: string[]): Promise<void> {
        const usePrivileged = !!config.privilegedAuth;
        const user = usePrivileged ? config.privilegedAuth.user : config.user;
        const pass = usePrivileged ? config.privilegedAuth.password : config.password;

        const args = ['--quiet'];
        if (config.uri) {
            args.push(config.uri);
        } else {
            args.push('--host', config.host);
            args.push('--port', String(config.port));
        }

        if (user && pass) {
            args.push('--username', user);
            args.push('--password', pass);
            if (config.authenticationDatabase) {
                 args.push('--authenticationDatabase', config.authenticationDatabase);
            } else if (!config.uri) {
                 args.push('--authenticationDatabase', 'admin');
            }
        }

        for (const dbName of databases) {
             const evalScript = `
                try {
                    var target = db.getSiblingDB('${dbName.replace(/'/g, "\\'")}');
                    target.createCollection('__perm_check_tmp');
                    target.getCollection('__perm_check_tmp').drop();
                } catch(e) {
                    print('ERROR: ' + e.message);
                    quit(1);
                }
             `;

             try {
                await execFileAsync('mongosh', [...args, '--eval', evalScript]);
             } catch(e: any) {
                 const msg = e.stdout || e.stderr || e.message || "";
                 if (msg.includes("not authorized") || msg.includes("Authorization") || msg.includes("requires authentication") || msg.includes("command create requires")) {
                     throw new Error(`Access denied to database '${dbName}'. Permissions?`);
                 }
                 throw e;
             }
        }
    },

    async dump(config: any, destinationPath: string, onLog?: (msg: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

        try {
            // mongodump creates a directory by default, or an archive with --archive
            // We want a single file, so we use --archive

            const args: string[] = [];

            if (config.uri) {
                // simple URI sanitization for logs
                const sanitizedUri = config.uri.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:*****@');
                logs.push(`Using URI: ${sanitizedUri}`);
                args.push(`--uri=${config.uri}`);
            } else {
                args.push('--host', config.host);
                args.push('--port', String(config.port));

                if (config.user && config.password) {
                     args.push('--username', config.user);
                     args.push('--password', config.password);
                     if (config.authenticationDatabase) {
                         args.push('--authenticationDatabase', config.authenticationDatabase);
                     } else {
                         args.push('--authenticationDatabase', 'admin');
                     }
                }
                if (config.database) {
                    args.push('--db', config.database);
                }
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

            args.push(`--archive=${destinationPath}`);
            args.push('--gzip');

            // Log command (mask password)
            const logArgs = args.map(arg => {
                if (arg === config.password) return '*****';
                if (arg.startsWith('--uri=')) return arg.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:*****@');
                return arg;
            });
            logs.push(`Executing command: mongodump ${logArgs.join(' ')}`);

            const { stdout, stderr } = await execFileAsync('mongodump', args);

            // mongodump writes to stderr
            if (stderr) {
                logs.push(`stderr: ${stderr}`);
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
            const args: string[] = [];

            if (config.uri) {
                 args.push(`--uri=${config.uri}`);
            } else {
                args.push('--host', config.host);
                args.push('--port', String(config.port));
                if (config.user && config.password) {
                     args.push('--username', config.user);
                     args.push('--password', config.password);
                }
            }

            args.push(`--archive=${sourcePath}`);
            args.push('--gzip');

            // Log command (mask password)
            const logArgs = args.map(arg => {
                if (arg === config.password) return '*****';
                if (arg.startsWith('--uri=')) return arg.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:*****@');
                return arg;
            });
            logs.push(`Executing restore command: mongorestore ${logArgs.join(' ')}`);

            const { stdout, stderr } = await execFileAsync('mongorestore', args);
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
    },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            const args = ['--eval', 'db.runCommand({ ping: 1 })', '--quiet'];

            if (config.uri) {
                args.push(config.uri);
            } else {
                args.push('--host', config.host);
                args.push('--port', String(config.port));
                if (config.user && config.password) {
                     args.push('--username', config.user);
                     args.push('--password', config.password);
                     if (config.authenticationDatabase) {
                        args.push('--authenticationDatabase', config.authenticationDatabase);
                     } else {
                        args.push('--authenticationDatabase', 'admin');
                     }
                }
            }

            await execFileAsync('mongosh', args);
            return { success: true, message: "Connection successful" };
        } catch (error: any) {
             return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
        }
    },

    async getDatabases(config: any): Promise<string[]> {
        const args = ['--eval', "db.adminCommand('listDatabases').databases.map(d => d.name).join(',')", '--quiet'];

        if (config.uri) {
            args.push(config.uri);
        } else {
            args.push('--host', config.host);
            args.push('--port', config.port.toString());
            if (config.user && config.password) {
                args.push('--username', config.user);
                args.push('--password', config.password);
                if (config.authenticationDatabase) {
                    args.push('--authenticationDatabase', config.authenticationDatabase);
                } else {
                    args.push('--authenticationDatabase', 'admin');
                }
            }
        }

        const { stdout } = await execFileAsync('mongosh', args);
        const sysDbs = ['admin', 'config', 'local'];
        return stdout.trim().split(',').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
    }
};
