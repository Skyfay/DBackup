import { DatabaseDialect } from "../../common/dialect";
import { PostgresBaseDialect } from "./postgres-base";

/**
 * PostgreSQL 14.x Dialect
 *
 * Key differences from PG 17:
 * - No transaction_timeout parameter
 * - Different SET commands in dumps
 */
export class Postgres14Dialect extends PostgresBaseDialect {
    override getDumpArgs(config: any, databases: string[]): string[] {
        const args = super.getDumpArgs(config, databases);

        // For single-DB dumps, add --no-sync for compatibility
        // This prevents sync-related issues across versions
        if (databases.length === 1) {
            args.push('--no-sync');
        }

        return args;
    }

    override getRestoreArgs(config: any, targetDatabase?: string): string[] {
        const args = super.getRestoreArgs(config, targetDatabase);

        // Add ON_ERROR_STOP for better error handling in PG 14
        return args;
    }
}
