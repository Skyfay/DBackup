import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { logger } from "@/lib/logging/logger";
import { isShutdownRequested } from "@/lib/server/shutdown";
import { isDatabaseMaintenanceActive, isRunHoldActive } from "@/lib/server/database-maintenance";
import { LEADING_RUNS } from "./follower-runs";

const log = logger.child({ module: "Queue" });

/**
 * The waiting runs the queue starts: those of a job, and a backup whose job was deleted, which then
 * ends at once. A system task, like the integrity check of a tenant or a check of copies, waits as
 * `Pending` without a job only until its own runner claims it, and is never the queue's to start.
 */
export const QUEUED_RUNS: Prisma.ExecutionWhereInput = {
    OR: [{ jobId: { not: null } }, { type: "Backup" }],
};

/**
 * Checks the queue and starts jobs if slots are available.
 *
 * A run waits while another run of the same job is still going, like one started by hand
 * during the scheduled one. Two runs of one job at once would plan the same position of an
 * incremental chain and could write the same file, so the waiting run starts right after,
 * when the queue is checked again at the end of the first.
 *
 * The queue is one for every tenant, so it reads the runs of all of them, whoever asks for it, and
 * starts each run in the tenant of its job.
 */
export function processQueue(): Promise<void> {
    return runAsSystem(processAllTenants);
}

async function processAllTenants() {
    // Skip queue processing during shutdown
    if (isShutdownRequested()) {
        log.info("Shutdown in progress - skipping queue processing");
        return;
    }

    // Pending runs stay queued. Database maintenance restarts the queue once it is done, also
    // when it only waits for the runs of now to end.
    if (isDatabaseMaintenanceActive() || isRunHoldActive()) {
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
    // A run that follows another one waits for that one, never for a slot of its own.
    const pending = await prisma.execution.findMany({
        where: { status: "Pending", AND: [LEADING_RUNS, QUEUED_RUNS] },
        orderBy: { startedAt: 'asc' }, // Creation time
        select: { id: true, jobId: true, tenantId: true },
    });

    if (pending.length === 0) {
        log.debug("No pending jobs");
        return;
    }

    // 3. The running runs the queue started fill slots, and their jobs are busy. A run that follows
    // another fills none, and neither does a restore or a system task like a check of copies, which
    // the queue never starts, so a long restore of one tenant holds no backup of another.
    const running = await prisma.execution.findMany({
        where: { status: "Running", AND: [LEADING_RUNS, QUEUED_RUNS] },
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
        promises.push(runAsTenant(execution.tenantId, () => executeQueuedJob(execution.id, execution.jobId!)));
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
