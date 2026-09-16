import { MySQLBaseDialect } from "./mysql-base";
import type { ExecutionHost } from "@/lib/transport";
import { MySQLConfig } from "@/lib/adapters/definitions";

export class MySQL80Dialect extends MySQLBaseDialect {
    supportsVersion(version: string): boolean {
        return version.includes('8.0.') || parseFloat(version) >= 8.0;
    }

    getDumpArgs(config: MySQLConfig, databases: string[], host?: ExecutionHost): string[] {
        const args = super.getDumpArgs(config, databases, host);

        // MySQL 8 default encoding. A --default-character-set in the source's
        // additional options wins, so a server the version check did not catch
        // can still be dumped with utf8 or whatever charset its client knows.
        if (!config.options?.includes('--default-character-set')) {
            args.push('--default-character-set=utf8mb4');
        }

        // Exclude system tables that often cause issues in 8.0 dumps
        // args.push('--ignore-table=mysql.innodb_index_stats');
        // args.push('--ignore-table=mysql.innodb_table_stats');

        return args;
    }
}
