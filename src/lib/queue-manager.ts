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
    for (const execution of pendingJobs) {
        // Trigger execution asynchronously
        executeQueuedJob(execution.id, execution.jobId!);
    }
}

async function executeQueuedJob(executionId: string, jobId: string) {
    console.log(`[Queue] Executing ${executionId} (Job ${jobId})`);

    // Setup Context (re-creating context similar to runJob)
    // We need to re-attach logger and updater to this resume execution.

    // Note: The original 'runJob' initialized the context and execution.
    // Here we need to reconstruct what's needed for the steps.

    // const logs: string[] = [];
    // We should probably load existing logs from DB if any?
    // Usually PENDING has no logs yet.

    const _currentProgress = 0;
    const _currentStage = "Starting";
    const _lastLogUpdate = 0;

    // We need a flush function similar to runner.ts
    // Duplication here is unfortunate. Ideally runner.ts exports the sensitive logic.
    // For now, I will create a Runner class or reuse logic.
    // I'll call a simplified version from here for now, but ideally we should export `performExecution` from `runner.ts`.

    await import("@/lib/runner").then(m => m.performExecution(executionId, jobId));
}
