// import { DatabaseDialect } from "../../common/dialect";
import { PostgresBaseDialect } from "./postgres-base";

/**
 * PostgreSQL 17.x Dialect
 *
 * New features in PG 17:
 * - transaction_timeout parameter
 * - Enhanced JSON functions
 * - New backup options
 */
export class Postgres17Dialect extends PostgresBaseDialect {
    override getDumpArgs(config: any, databases: string[]): string[] {
        const args = super.getDumpArgs(config, databases);

        // PG 17 specific optimizations
        if (databases.length === 1) {
            args.push('--no-sync');
            // PG 17 has better incremental backup support
            args.push('--encoding=UTF8'); // Explicit UTF8
        }

        return args;
    }
}
