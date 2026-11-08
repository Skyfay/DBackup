import { logger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

const log = logger.child({ module: "Shutdown" });

/** Whether a shutdown has been requested */
let isShuttingDown = false;

/** Poll interval for checking running executions */
const POLL_INTERVAL_MS = 2000;

/**
 * How long a shutdown waits for running executions before cancelling them.
 *
 * Long enough that an ordinary backup finishes rather than being cut off, short enough that
 * a stuck one cannot hold a restart open indefinitely. Docker's default stop timeout is 10 s
 * and it sends SIGKILL after that, so anything beyond this is decided by the runtime anyway -
 * better to end cleanly on our own terms and leave an accurate record behind.
 */
const SHUTDOWN_GRACE_MS = 5 * 60 * 1000;

/**
 * Signals every running execution to stop and records it as failed.
 *
 * Signalling first gives a run that is between steps the chance to unwind properly - close
 * its connections, clean up its temp files. The database is then corrected regardless,
 * because a row left as `Running` after the process is gone blocks the queue on the next
 * start until something notices.
 */
async function abortRunningExecutions(): Promise<void> {
    try {
        const { abortExecution } = await import("@/lib/execution/abort");
        const running = await prisma.execution.findMany({
            where: { status: "Running" },
            select: { id: true },
        });

        for (const { id } of running) abortExecution(id);

        await prisma.execution.updateMany({
            where: { status: "Running" },
            data: { status: "Failed", endedAt: new Date() },
        });
    } catch (error) {
        log.warn("Failed to cancel running executions during shutdown", { error: String(error) });
    }
}

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
            log.warn("Forced shutdown - second signal received", { signal });
            process.exit(1);
        }

        isShuttingDown = true;
        log.info(`Received ${signal} - starting graceful shutdown...`);

        // A signal arrives outside the scope the listeners were registered in, and the runs of
        // every tenant count, so the shutdown names its scope itself.
        runAsSystem(() => performShutdown(signal)).then(() => {
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
        const { scheduler } = await import("@/lib/server/scheduler");
        scheduler.stopAll();
        log.info("Scheduler stopped");
    } catch (error) {
        log.warn("Failed to stop scheduler", { error: String(error) });
    }

    // 2. Wait for running executions to finish, but not forever. A backup blocked on a
    //    source that stopped answering never completes, and waiting on it turned an ordinary
    //    restart into one that only ends when the container runtime loses patience and sends
    //    SIGKILL. Past the deadline the remaining runs are cancelled and recorded as failed,
    //    which is both true and visible - unlike a process killed mid-write.
    let lastLoggedCount = -1;
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;

    while (true) {
        try {
            const runningCount = await prisma.execution.count({
                where: { status: "Running" },
            });

            if (runningCount === 0) {
                log.info("All executions finished");
                break;
            }

            if (Date.now() >= deadline) {
                log.warn(
                    `${runningCount} execution(s) did not finish within the shutdown grace period - cancelling them`,
                    { runningCount, graceMs: SHUTDOWN_GRACE_MS },
                );
                await abortRunningExecutions();
                break;
            }

            if (runningCount !== lastLoggedCount) {
                log.info(
                    `Waiting for ${runningCount} running execution(s) to finish before shutting down...`,
                    { runningCount, graceMs: SHUTDOWN_GRACE_MS },
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

    // 3. Cancel pending jobs - they won't be picked up after shutdown
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
