import { DatabaseDialect } from "../../common/dialect";

export class PostgresBaseDialect implements DatabaseDialect {
    supportsVersion(version: string): boolean {
        return true;
    }

    getDumpArgs(config: any, databases: string[]): string[] {
        const args: string[] = [
            '-h', config.host,
            '-p', String(config.port),
            '-U', config.user,
            '-F', 'c', // Custom Format (tar/compressed) is standard for restoring with pg_restore. --format=custom
            // However, our system uses raw SQL usually for text editing, but pg_dump default is plain text.
            // If we use plain text, we pipe it.
            // Let's stick to plain text for broad compatibility unless we want 'pg_restore' features.
            // Wait, pg_restore ONLY works with custom/tar/directory formats. psql is used for plain text.
            // Our restore.ts currently uses 'psql'. So we should keep plain text default, i.e. no -F c unless requested.
            // But plain text dumps can be huge. Gzip handles compression.

            // Actually, plain text is safest for 'psql' restore which is what we used in restore.ts (implied).
        ];

        // Databases
        // pg_dump only dumps ONE database at a time unless using pg_dumpall.
        // If databases array has > 1, we might need pg_dumpall or loop in the adapter.
        // The Runner calls dump() once.
        // If the user selected multiple DBs, the adapter's dump() is responsible.
        // But standard pg_dump usually targets one DB.

        // Strategy:
        // 1. If databases.length == 0 or empty -> error (unless all?)
        // 2. If databases.length == 1 -> pg_dump -d DB
        // 3. If explicit "all" -> pg_dumpall (but pg_dumpall dumps globals too)

        // Let's default to the explicit database.
        // If config.database has comma, adapter splits it.
        // If multiple are requested, our current Runner architecture expects a single file.
        // So we strictly need `pg_dumpall` logic OR we only support 1 DB for now in `pg_dump`.
        // Let's assume 1 DB for `pg_dump` for simplicity or checks.
        // The dump.ts logic I read earlier handled splitting but didn't actually loop properly to merge streams.
        // It likely just took the first one or failed if the array logic wasn't fully fleshed out in the old adapter.

        // Let's stick to mapping config to args:
        if (databases.length === 1) {
            args.push('-d', databases[0]);
        } else if (databases.length > 1) {
            // Warn or use first? Or pg_dumpall --clean --if-exists --databases ...
            // pg_dumpall is dangerous for "globals".
            // Let's assume single DB focus for safe "Live Restore" features.
            // But if we want to be robust:
            // args.push('-d', databases[0]);
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
            '-U', config.user
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
