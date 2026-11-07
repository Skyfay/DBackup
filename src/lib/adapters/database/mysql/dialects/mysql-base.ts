import { BaseDialect } from "../../common/dialect";
import { MySQLConfig } from "@/lib/adapters/definitions";
import type { ExecutionHost } from "@/lib/transport";
import { buildConnectionArgs } from "../args";
import { contentArgs, optionTokens, type DumpClient } from "../dump-content";
import { assertDatabaseArgument } from "@/lib/adapters/database/common/database-name";

export class MySQLBaseDialect extends BaseDialect {
    /** `client` is the dump tool that runs, which decides the flags only MySQL's own mysqldump knows. */
    getDumpArgs(config: MySQLConfig, databases: string[], host?: ExecutionHost, client?: DumpClient): string[] {
        const args = [
            ...buildConnectionArgs(config, host, { includeSsl: false }),
            '--net-buffer-length=16384' // Limit INSERT size to ~16KB to prevent OOM during restore
        ];

        this.appendAuthArgs(args, config, client);

        // What the dump holds besides tables, before the extra options so a --skip-routines there wins.
        args.push(...contentArgs(config, client));
        args.push(...optionTokens(config.options));

        // Single database dump (Multi-DB is handled via TAR in dump.ts)
        if (databases.length === 1) {
            // A name, never an option, see `database-name.ts`.
            args.push('--databases', assertDatabaseArgument(databases[0]));
        }

        return args;
    }

    /** `client` is the mysql client that runs, which decides how TLS is turned off. */
    getRestoreArgs(config: MySQLConfig, targetDatabase?: string, host?: ExecutionHost, client?: DumpClient): string[] {
        const args = [
            ...buildConnectionArgs(config, host, { includeSsl: false }),
            '--max-allowed-packet=64M',
        ];

        this.appendAuthArgs(args, config, client);

        // The target database as the value of --database, so the client reads it as a name and
        // never as an option, whatever it starts with. A `USE dbname;` in the dump still wins.
        if (targetDatabase) {
            args.push(`--database=${assertDatabaseArgument(targetDatabase)}`);
        }

        return args;
    }

    getConnectionArgs(config: MySQLConfig): string[] {
        const args = [
            '-h', config.host,
            '-P', String(config.port),
            '-u', config.user,
            '--protocol=tcp'
        ];
        this.appendAuthArgs(args, config);
        return args;
    }

    protected appendAuthArgs(args: string[], config: MySQLConfig, client?: DumpClient) {
        // The password goes into a defaults file, see withAuthArgs, so only TLS is left here.
        // The client that runs decides the flag, not the server: the Docker image ships MariaDB's,
        // which refuses --ssl-mode, and MySQL's own refuses --skip-ssl from 8.0 on.
        if (config.disableSsl) {
            args.push(client?.sslOff ?? '--skip-ssl');
        }
    }
}
