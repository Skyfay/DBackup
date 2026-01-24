import prisma from "@/lib/prisma";
// import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
// import { stepUpload } from "@/lib/runner/steps/03-upload";
// import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";
// import { stepInitialize } from "@/lib/runner/steps/01-initialize";

/**
 * Checks the queue and starts jobs if slots are available.
 */
export async function processQueue() {
    console.log("[Queue] Processing queue...");

    // 1. Get concurrency limit
    const setting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const maxJobs = setting ? parseInt(setting.value) : 1;

    // 2. Count running jobs
    const runningCount = await prisma.execution.count({
        where: { status: "Running" }
    });

    if (runningCount >= maxJobs) {
        console.log(`[Queue] Saturation reached (${runningCount}/${maxJobs} running).`);
        return;
    }

    const availableSlots = maxJobs - runningCount;
    if (availableSlots <= 0) return;

    // 3. Get pending jobs (FIFO)
    const pendingJobs = await prisma.execution.findMany({
        where: { status: "Pending" },
        orderBy: { startedAt: 'asc' }, // Creation time
        take: availableSlots,
        include: { job: true }
    });

    if (pendingJobs.length === 0) {
        console.log("[Queue] No pending jobs.");
        return;
    }

    console.log(`[Queue] Starting ${pendingJobs.length} jobs.`);

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

async function executeQueuedJob(executionId: string, jobId: string) {
    console.log(`[Queue] Executing ${executionId} (Job ${jobId})`);

    // Dynamic import is fine, but for testing we need to ensure the mocked module is used if possible
    // When using vitest, import() should use the mock registry.

    // We import directly at top level if possible or use full dynamic
    const runner = await import("@/lib/runner");
    await runner.performExecution(executionId, jobId);
}
