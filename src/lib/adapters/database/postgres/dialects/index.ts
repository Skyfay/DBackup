import { DatabaseDialect } from "../../common/dialect";
import { PostgresBaseDialect } from "./postgres-base";
import { Postgres14Dialect } from "./postgres-14";
import { Postgres16Dialect } from "./postgres-16";
import { Postgres17Dialect } from "./postgres-17";

/**
 * Returns the appropriate PostgreSQL dialect based on detected version.
 *
 * Version-specific dialects prevent compatibility issues:
 * - PG 14/16: No transaction_timeout parameter
 * - PG 17: New transaction_timeout and enhanced features
 *
 * @param adapterId - The adapter ID (postgres)
 * @param version - Detected PostgreSQL version string (e.g., "PostgreSQL 16.1")
 */
export function getDialect(adapterId: string, version?: string): DatabaseDialect {
    if (!version) {
        // Default to base if version not detected
        return new PostgresBaseDialect();
    }

    const lowerV = version.toLowerCase();

    // PostgreSQL 17.x
    if (lowerV.includes('17.') || lowerV.includes('postgresql 17')) {
        return new Postgres17Dialect();
    }

    // PostgreSQL 16.x
    if (lowerV.includes('16.') || lowerV.includes('postgresql 16')) {
        return new Postgres16Dialect();
    }

    // PostgreSQL 15.x (compatible with 16)
    if (lowerV.includes('15.') || lowerV.includes('postgresql 15')) {
        return new Postgres16Dialect(); // Use PG16 dialect (compatible)
    }

    // PostgreSQL 14.x
    if (lowerV.includes('14.') || lowerV.includes('postgresql 14')) {
        return new Postgres14Dialect();
    }

    // PostgreSQL 13.x and earlier (use 14 dialect for compatibility)
    if (lowerV.includes('13.') || lowerV.includes('12.') || lowerV.includes('postgresql 13') || lowerV.includes('postgresql 12')) {
        return new Postgres14Dialect();
    }

    // Default fallback to PG16 (most common in 2026)
    return new Postgres16Dialect();
}
