import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";

const log = logger.child({ module: "Shutdown" });

/** Whether a shutdown has been requested */
let isShuttingDown = false;

/** Poll interval for checking running executions */
const POLL_INTERVAL_MS = 2000;

/**
 * Returns whether the application is currently shutting down.
 * Can be checked by the queue manager to skip starting new jobs.
 */
export function isShutdownRequested(): boolean {
    return isShuttingDown;
}

/**
 * Registers SIGTERM and SIGINT handlers for graceful shutdown.
 * Called once during application instrumentation.
 *
 * Shutdown sequence:
 * 1. Set shutdown flag (prevents new jobs from starting)
 * 2. Stop scheduler (no new cron triggers)
 * 3. Wait indefinitely for running executions to finish
 * 4. Cancel any pending executions (they won't be picked up)
 * 5. Disconnect database
 * 6. Exit process
 *
 * Sending a second signal (e.g. Ctrl+C twice) forces immediate exit.
 */
export function registerShutdownHandlers(): void {
    const handler = (signal: string) => {
        if (isShuttingDown) {
            log.warn("Forced shutdown — second signal received", { signal });
            process.exit(1);
        }

        isShuttingDown = true;
        log.info(`Received ${signal} — starting graceful shutdown...`);

        performShutdown(signal).then(() => {
            log.info("Graceful shutdown complete");
            process.exit(0);
        }).catch((error) => {
            log.error("Error during shutdown", { error: String(error) });
            process.exit(1);
        });
    };

    process.on("SIGTERM", () => handler("SIGTERM"));
    process.on("SIGINT", () => handler("SIGINT"));

    log.info("Graceful shutdown handlers registered");
}

async function performShutdown(signal: string): Promise<void> {
    // 1. Stop scheduler to prevent new cron triggers
    try {
        const { scheduler } = await import("@/lib/scheduler");
        scheduler.stopAll();
        log.info("Scheduler stopped");
    } catch (error) {
        log.warn("Failed to stop scheduler", { error: String(error) });
    }

    // 2. Wait for all running executions to complete (no timeout — the app
    //    stays alive until every backup/restore finishes or a second signal
    //    forces immediate exit)
    let lastLoggedCount = -1;

    while (true) {
        try {
            const runningCount = await prisma.execution.count({
                where: { status: "Running" },
            });

            if (runningCount === 0) {
                log.info("All executions finished");
                break;
            }

            if (runningCount !== lastLoggedCount) {
                log.info(
                    `Waiting for ${runningCount} running execution(s) to finish before shutting down...`,
                    { runningCount },
                );
                lastLoggedCount = runningCount;
            }

            // Poll every 2 seconds
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        } catch (error) {
            log.warn("Error checking running executions", { error: String(error) });
            break;
        }
    }

    // 3. Cancel pending jobs — they won't be picked up after shutdown
    try {
        const pendingCount = await prisma.execution.count({
            where: { status: "Pending" },
        });

        if (pendingCount > 0) {
            log.warn(`Cancelling ${pendingCount} pending execution(s)`);

            await prisma.execution.updateMany({
                where: { status: "Pending" },
                data: {
                    status: "Failed",
                    endedAt: new Date(),
                },
            });
        }
    } catch (error) {
        log.warn("Failed to update execution statuses", { error: String(error) });
    }

    // 4. Disconnect database
    try {
        await prisma.$disconnect();
        log.info("Database disconnected");
    } catch (error) {
        log.warn("Failed to disconnect database", { error: String(error) });
    }

    log.info(`Shutdown complete (signal: ${signal})`);
}
