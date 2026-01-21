import { DatabaseDialect } from "../../common/dialect";

export class PostgresBaseDialect implements DatabaseDialect {
    supportsVersion(version: string): boolean {
        return true;
    }

    getDumpArgs(config: any, databases: string[]): string[] {
        // Multi-Database Support:
        // - Single DB: Use pg_dump with -Fc (custom format) for compression and pg_restore compatibility
        // - Multiple DBs: Use pg_dumpall in plain SQL format for psql-based filtering and renaming

        if (databases.length > 1) {
            // Multi-DB: Use pg_dumpall for plain SQL output
            const args: string[] = [
                '-h', config.host,
                '-p', String(config.port),
                '-U', config.user,
                '--no-role-passwords', // Don't dump passwords
                '--clean', // Add DROP commands
                '--if-exists' // Use IF EXISTS for DROP
            ];

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

            return args;
        }

        // Single DB: Use pg_dump with custom format
        const args: string[] = [
            '-h', config.host,
            '-p', String(config.port),
            '-U', config.user,
            '-F', 'c', // Custom Format for single DB (compressed, binary)
            '-Z', '6', // Compression level
        ];

        // Single database
        if (databases.length === 1) {
            args.push('-d', databases[0]);
        } else if (config.database) {
            args.push('-d', config.database);
        }

        // Add options
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

        return args;
    }

    getRestoreArgs(config: any, targetDatabase?: string): string[] {
        const args: string[] = [
            '-h', config.host,
            '-p', String(config.port),
            '-U', config.user,
            '-w' // Never prompt for password
        ];

        if (targetDatabase) {
             args.push('-d', targetDatabase);
        } else if (config.database && typeof config.database === 'string') {
             args.push('-d', config.database);
        } else {
            // Connect to 'postgres' to run CREATE DATABASE for others?
            // Restore usually pipes into a connection.
            args.push('-d', 'postgres');
        }

         // Add options
        if (config.options) {
             const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
             for (const part of parts) {
                 // Filter out dump-only options if mixed in config?
                 // Ideally config for restore options should be separate or general.
                 // For now, simple pass through might be risky (e.g. --clean is valid for restore via psql?)
                 // psql takes different args than pg_dump.
                 // We should probably NOT pass 'config.options' blindly to restore command if they are dump options.
                 // Ignoring for now to be safe, or allow specific restore options.
             }
        }

        return args;
    }

    getConnectionArgs(config: any): string[] {
        // Postgres auth is env based usually.
        return [
            '-h', config.host,
            '-p', String(config.port),
            '-U', config.user
        ];
    }
}
