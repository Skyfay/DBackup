import { MySQLBaseDialect } from "./mysql-base";

export class MySQL80Dialect extends MySQLBaseDialect {
    supportsVersion(version: string): boolean {
        return version.includes('8.0.') || parseFloat(version) >= 8.0;
    }

    getDumpArgs(config: any, databases: string[]): string[] {
        const args = super.getDumpArgs(config, databases);

        // MySQL 8 default encoding
        args.push('--default-character-set=utf8mb4');

        // Exclude system tables that often cause issues in 8.0 dumps
        // args.push('--ignore-table=mysql.innodb_index_stats');
        // args.push('--ignore-table=mysql.innodb_table_stats');

        return args;
    }
}
