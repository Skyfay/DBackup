/**
 * Database Maintenance Flag
 *
 * Set while VACUUM or a database snapshot runs. Both hold Prisma's single SQLite connection for
 * as long as they take, so every other query waits behind them and fails once the pool timeout
 * is reached. Anything that would start a backup, restore or system task checks this flag first
 * and holds off instead.
 *
 * Kept on globalThis so the queue, the services and the API routes see the same value even when
 * the bundler gives them separate module instances.
 */

import { ServiceError } from "@/lib/logging/errors";

/** Error code for work that cannot start during maintenance. The API maps it to 409. */
export const DATABASE_BUSY = "DATABASE_BUSY";

const globalForMaintenance = globalThis as unknown as {
    databaseMaintenanceActive: boolean | undefined;
};

export function isDatabaseMaintenanceActive(): boolean {
    return globalForMaintenance.databaseMaintenanceActive === true;
}

/** Claims the flag. Returns false when another maintenance operation already holds it. */
export function beginDatabaseMaintenance(): boolean {
    if (globalForMaintenance.databaseMaintenanceActive) return false;
    globalForMaintenance.databaseMaintenanceActive = true;
    return true;
}

export function endDatabaseMaintenance(): void {
    globalForMaintenance.databaseMaintenanceActive = false;
}

/** Throws for a run that would otherwise start in the middle of maintenance. */
export function assertNoDatabaseMaintenance(operation: string): void {
    if (isDatabaseMaintenanceActive()) {
        throw new ServiceError(
            "DatabaseMaintenance",
            operation,
            "Database maintenance is in progress. Try again in a moment.",
            { code: DATABASE_BUSY }
        );
    }
}
