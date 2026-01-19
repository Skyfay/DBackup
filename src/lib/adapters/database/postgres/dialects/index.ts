import { DatabaseDialect } from "../../common/dialect";
import { PostgresBaseDialect } from "./postgres-base";

export function getDialect(adapterId: string, version?: string): DatabaseDialect {
    // We can extend this for Postgres 12 vs 16 specific flags if needed.
    // For now, base is sufficient.
    return new PostgresBaseDialect();
}
