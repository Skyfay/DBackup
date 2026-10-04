/**
 * The system task Optimize the database. Like Optimize under Settings, Database, it rebuilds the
 * file without its unused space, but only once enough of it is unused, and it waits for the runs
 * of now to end instead of being refused.
 */

import prisma from "@/lib/prisma";
import { beginRunHold, endRunHold, isDatabaseMaintenanceActive, DATABASE_BUSY } from "@/lib/server/database-maintenance";
import { ServiceError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getDatabaseInfo, vacuumDatabase, type VacuumResult } from "./database-service";

const log = logger.child({ service: "DatabaseOptimize" });

/** The share of the file that has to be unused before the task rebuilds it. */
export const OPTIMIZE_MIN_SHARE = 0.2;
/** Less than this is not worth holding a run back for. */
export const OPTIMIZE_MIN_BYTES = 1024 * 1024;
/** How long the task waits for the runs of now to end. */
export const OPTIMIZE_MAX_WAIT_MS = 60 * 60 * 1000;
/** How often it looks whether they did. */
const POLL_MS = 15 * 1000;

export type OptimizeOutcome =
    | { status: "skipped"; reclaimableBytes: number }
    | { status: "waited"; running: number }
    | ({ status: "done" } & VacuumResult);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const runningNow = () => prisma.execution.count({ where: { status: "Running" } });

/**
 * Rebuilds the database once a fifth of it, and at least 1 MB, is unused. First it holds new runs
 * back, so the queue keeps them, and waits up to an hour for the running ones. The held runs start
 * right after, also when it gives up.
 */
export async function optimizeDatabase(): Promise<OptimizeOutcome> {
    const { reclaimableBytes, totalBytes } = await getDatabaseInfo();
    if (reclaimableBytes < OPTIMIZE_MIN_BYTES || reclaimableBytes < totalBytes * OPTIMIZE_MIN_SHARE) {
        return { status: "skipped", reclaimableBytes };
    }

    if (!beginRunHold()) {
        throw new ServiceError("DatabaseOptimize", "optimize", "Another database maintenance is waiting already.", { code: DATABASE_BUSY });
    }
    try {
        const deadline = Date.now() + OPTIMIZE_MAX_WAIT_MS;
        let running = await runningNow();
        // A download of the database or Optimize under Database holds it too, so it waits for those.
        while (running > 0 || isDatabaseMaintenanceActive()) {
            if (Date.now() >= deadline) {
                log.warn("Gave up optimizing the database, runs kept going", { running });
                return { status: "waited", running };
            }
            await sleep(POLL_MS);
            running = await runningNow();
        }
        return { status: "done", ...(await vacuumDatabase()) };
    } finally {
        endRunHold();
        // The runs held back start now. Imported lazily because the queue pulls in the whole runner.
        import("@/lib/execution/queue-manager")
            .then(({ processQueue }) => processQueue())
            .catch((error: unknown) => log.error("Failed to resume the queue after optimizing the database", {}, wrapError(error)));
    }
}
