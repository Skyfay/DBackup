import { DatabaseDialect } from "../../common/dialect";

export class MongoDBBaseDialect implements DatabaseDialect {
    getDumpArgs(config: any, databases: string[]): string[] {
        const args: string[] = [];

        if (config.uri) {
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
        }

        // Database Selection
        // mongodump dumps all if no --db is specified.
        // But for consistency we might want to restrict if databases are provided.
        // mongodump --db X
        if (databases.length === 1) {
            args.push('--db', databases[0]);
        }
        // If multiple DBs, mongodump doesn't support list easily without multiple runs or regex exclude?
        // Actually mongodump doesn't take a list. It takes one --db or --all (implied).
        // Or one collection.
        // We will stick to single DB for now or let the caller loop (like we did for Postgres).

        // For mongodump we usually want --archive to stream
        args.push('--archive');
        args.push('--gzip');

         if (config.options) {
             // Handle simple options parsing if needed, similar to other adapters
             // Or push raw string parts if they don't contain spaces...
             // Let's implement basic parsing reuse if we can, or duplication for now.
             const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
             for (const part of parts) {
                if (part.startsWith('"') && part.endsWith('"')) args.push(part.slice(1, -1));
                else if (part.startsWith("'") && part.endsWith("'")) args.push(part.slice(1, -1));
                else args.push(part);
             }
        }

        return args;
    }

    getRestoreArgs(config: any, targetDatabase?: string): string[] {
        const args: string[] = [];

        if (config.uri) {
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
        }

        args.push('--archive'); // We expect input from stdin as archive
        args.push('--gzip');

        // For restore, we can remap using --nsInclude or --nsFrom/--nsTo in recent mongo versions.
        // Or if simple restore, --db?
        // mongorestore --archive < file
        // If we want to restore to a SPECIFIC DB from an archive that contains that DB, we might need --nsFrom/--nsTo if the name changes.
        // If we just want to filter: --nsInclude 'dbname.*'

        // If targetDatabase is different from source, we need remapping.
        // But DatabaseDialect doesn't know source DB name easily here.
        // We assume config.database is the target if set.

        // This is complex for Mongo.
        // If targetDatabase provided:
        // args.push('--nsFrom', '*', '--nsTo', targetDatabase + '.*'); // Rough approximation, might be risky.

        // Let's stick to basic args for connection.

        return args;
    }

    getConnectionArgs(config: any): string[] {
        // Used for mongosh?
        const args: string[] = [];
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
        return args;
    }
}
