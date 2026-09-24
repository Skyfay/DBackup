import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { isShutdownRequested } from "@/lib/server/shutdown";
import { isDatabaseMaintenanceActive } from "@/lib/server/database-maintenance";

const log = logger.child({ module: "Queue" });

/**
 * Checks the queue and starts jobs if slots are available.
 *
 * A run waits while another run of the same job is still going, like one started by hand
 * during the scheduled one. Two runs of one job at once would plan the same position of an
 * incremental chain and could write the same file, so the waiting run starts right after,
 * when the queue is checked again at the end of the first.
 */
export async function processQueue() {
    // Skip queue processing during shutdown
    if (isShutdownRequested()) {
        log.info("Shutdown in progress - skipping queue processing");
        return;
    }

    // Pending runs stay queued. Database maintenance restarts the queue once it is done.
    if (isDatabaseMaintenanceActive()) {
        log.debug("Database maintenance in progress - skipping queue processing");
        return;
    }

    log.debug("Processing queue...");

    // 1. Get concurrency limit
    const setting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const maxJobs = setting ? parseInt(setting.value) : 1;

    // 2. Get pending runs (FIFO). Read before the running ones on purpose: a run that a
    // concurrent call claims after this read is still in this list as the first of its job, so
    // this call picks that one, and its claim in performExecution fails. A run claimed before
    // this read shows up as running below. Either way no second run of a job starts beside it.
    const pending = await prisma.execution.findMany({
        where: { status: "Pending" },
        orderBy: { startedAt: 'asc' }, // Creation time
        select: { id: true, jobId: true },
    });

    if (pending.length === 0) {
        log.debug("No pending jobs");
        return;
    }

    // 3. Running runs fill slots, and their jobs are busy
    const running = await prisma.execution.findMany({
        where: { status: "Running" },
        select: { jobId: true },
    });

    if (running.length >= maxJobs) {
        log.debug("Saturation reached", { runningCount: running.length, maxJobs });
        return;
    }

    const availableSlots = maxJobs - running.length;
    const busyJobs = new Set(running.flatMap((execution) => (execution.jobId ? [execution.jobId] : [])));

    // The oldest waiting run of every job that is not running, up to the free slots.
    const pendingJobs: typeof pending = [];
    for (const execution of pending) {
        if (pendingJobs.length >= availableSlots) break;
        if (execution.jobId && busyJobs.has(execution.jobId)) {
            log.debug("Run waits for the running one of its job", { executionId: execution.id, jobId: execution.jobId });
            continue;
        }
        // A run whose job was deleted starts as before and ends right there.
        if (execution.jobId) busyJobs.add(execution.jobId);
        pendingJobs.push(execution);
    }

    if (pendingJobs.length === 0) {
        log.debug("Every pending run waits for a run of its job");
        return;
    }

    log.info("Starting jobs", { count: pendingJobs.length });

    // 4. Start them
    const promises = [];
    for (const execution of pendingJobs) {
        // Trigger execution asynchronously
        // We push to array to possibly await them, or just to catch errors
        promises.push(executeQueuedJob(execution.id, execution.jobId!));
    }

    // For testing purposes, we wait significantly longer than we think is needed.
    // In production this helps prevent a stampede if we restart.
    await Promise.allSettled(promises);
}

/**
 * The runner, imported once and shared by every run. It imports the queue itself, so it is loaded
 * when the first run starts. One import for all also keeps two runs started at the same moment
 * from each importing it on their own, which a test's module mock does not survive.
 */
let runner: Promise<typeof import("@/lib/runner")> | undefined;

async function executeQueuedJob(executionId: string, jobId: string) {
    log.debug("Executing queued job", { executionId, jobId });

    runner ??= import("@/lib/runner").catch((error: unknown) => {
        // A failed import is tried again by the next run instead of failing every one after it.
        runner = undefined;
        throw error;
    });
    await (await runner).performExecution(executionId, jobId);
}
