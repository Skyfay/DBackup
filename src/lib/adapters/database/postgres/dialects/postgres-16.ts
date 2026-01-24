// import { DatabaseDialect } from "../../common/dialect";
import { PostgresBaseDialect } from "./postgres-base";

/**
 * PostgreSQL 16.x Dialect
 *
 * Key differences from PG 17:
 * - No transaction_timeout parameter
 * - Compatible with PG 14 dumps (if created with correct pg_dump version)
 */
export class Postgres16Dialect extends PostgresBaseDialect {
    override getDumpArgs(config: any, databases: string[]): string[] {
        const args = super.getDumpArgs(config, databases);

        // Add --no-sync for better performance
        if (databases.length === 1) {
            args.push('--no-sync');
        }

        return args;
    }
}
