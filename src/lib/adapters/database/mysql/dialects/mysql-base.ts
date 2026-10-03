import { BaseDialect } from "../../common/dialect";
import { MySQLConfig } from "@/lib/adapters/definitions";
import type { ExecutionHost } from "@/lib/transport";
import { buildConnectionArgs } from "../args";
import { contentArgs, optionTokens, type DumpClient } from "../dump-content";

export class MySQLBaseDialect extends BaseDialect {
    /** `client` is the dump tool that runs, which decides the flags only MySQL's own mysqldump knows. */
    getDumpArgs(config: MySQLConfig, databases: string[], host?: ExecutionHost, client?: DumpClient): string[] {
        const args = [
            ...buildConnectionArgs(config, host, { includeSsl: false }),
            '--net-buffer-length=16384' // Limit INSERT size to ~16KB to prevent OOM during restore
        ];

        this.appendAuthArgs(args, config);

        // What the dump holds besides tables, before the extra options so a --skip-routines there wins.
        args.push(...contentArgs(config, client));
        args.push(...optionTokens(config.options));

        // Single database dump (Multi-DB is handled via TAR in dump.ts)
        if (databases.length === 1) {
            args.push('--databases', databases[0]);
        }

        return args;
    }

    getRestoreArgs(config: MySQLConfig, targetDatabase?: string, host?: ExecutionHost): string[] {
        const args = [
            ...buildConnectionArgs(config, host, { includeSsl: false }),
            '--max-allowed-packet=64M',
        ];

        this.appendAuthArgs(args, config);

        // Target DB is usually passed in the stream, but some tools need it in CLI
        // For mysql client, if we want to force restoration into a specific DB, we append it.
        // BUT: if the dump contains `USE dbname;`, this might be overridden.
        if (targetDatabase) {
           args.push(targetDatabase);
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

    protected appendAuthArgs(args: string[], config: MySQLConfig) {
        // Password is usually passed via env var, but some contexts might use -p
        // We generally rely on MYSQL_PWD env var for security, so we don't append -p here.

        // SSL Handling - Default behavior for generic MySQL
        if (config.disableSsl) {
            // Check if we are running in an environment that supports --ssl-mode (MySQL 5.7.11+)
            // Since we use Alpine Linux, the installed 'mysql-client' is actually MariaDB Client.
            // MariaDB Client does not support --ssl-mode=DISABLED, it uses --skip-ssl.
            args.push('--skip-ssl');
        }
    }
}
