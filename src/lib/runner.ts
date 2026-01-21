import { RunnerContext } from "@/lib/runner/types";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
import { stepUpload } from "@/lib/runner/steps/03-upload";
import { stepRetention } from "@/lib/runner/steps/05-retention";
import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";
import prisma from "@/lib/prisma";
import { processQueue } from "@/lib/queue-manager";

/**
 * Entry point for scheduling/running a job.
 * It now enqueues the job instead of running immediately.
 */
export async function runJob(jobId: string) {
    console.log(`[Runner] Enqueuing Job ID: ${jobId}`);

    try {
        const execution = await prisma.execution.create({
            data: {
                jobId: jobId,
                status: "Pending",
                logs: JSON.stringify([`${new Date().toISOString()}: Job queued`]),
                metadata: JSON.stringify({ progress: 0, stage: "Queued" })
            }
        });

        // Trigger queue processing
        // We don't await this because we want to return the execution ID immediately to the UI
        processQueue().catch(e => console.error("Queue trigger failed", e));

        return { success: true, executionId: execution.id, message: "Job queued successfully" };

    } catch (e: any) {
        console.error("Failed to enqueue job", e);
        throw e;
    }
}

/**
 * The actual execution logic (called by the Queue Manager).
 */
export async function performExecution(executionId: string, jobId: string) {
    console.log(`[Runner] Starting execution ${executionId}`);

    // 1. Mark as RUNNING
    await prisma.execution.update({
        where: { id: executionId },
        data: {
            status: "Running",
            startedAt: new Date(), // Reset start time to actual run time
        }
    });

    let currentProgress = 0;
    let currentStage = "Initializing";
    let lastLogUpdate = 0;

    // Declare ctx early
    let ctx: RunnerContext;

    // Fetch initial logs (the "Job queued" message)
    const initialExe = await prisma.execution.findUnique({ where: { id: executionId } });
    const logs: string[] = initialExe?.logs ? JSON.parse(initialExe.logs) : [];

    // Throttled flush function
    let isFlushing = false;
    let hasPendingFlush = false;

    const flushLogs = async (id: string, force = false) => {
        const now = Date.now();
        const shouldRun = force || (now - lastLogUpdate > 1000);

        if (!shouldRun) return;

        if (isFlushing) {
            hasPendingFlush = true;
            return;
        }

        isFlushing = true;

        const performUpdate = async () => {
             try {
                lastLogUpdate = Date.now();
                await prisma.execution.update({
                    where: { id: id },
                    data: {
                        logs: JSON.stringify(logs),
                        metadata: JSON.stringify({ progress: currentProgress, stage: currentStage })
                    }
                });
            } catch (e) {
                console.error("Failed to flush logs", e);
            }
        };

        try {
            await performUpdate();
            if (hasPendingFlush) {
                hasPendingFlush = false;
                 await performUpdate();
            }
        } finally {
            isFlushing = false;
        }
    };

    const log = (msg: string) => {
        console.log(`[Job ${jobId}] ${msg}`);
        logs.push(`${new Date().toISOString()}: ${msg}`);
        // Can't await inside sync log function, but flushLogs is async and handles it
        flushLogs(executionId);
    };

    const updateProgress = (percent: number, stage?: string) => {
        currentProgress = percent;
        if (stage) currentStage = stage;
        if (ctx) ctx.metadata = { ...ctx.metadata, progress: currentProgress, stage: currentStage };
        flushLogs(executionId);
    };

    // Create Context
    // We cast initialExe to any because Prisma types might mismatch RunnerContext expectation slightly,
    // but stepInitialize usually overwrites/fixes it.
    ctx = {
        jobId,
        logs,
        log,
        updateProgress,
        status: "Running",
        startedAt: new Date(),
        execution: initialExe as any
    };

    try {
        log("Taking job from queue...");

        // 1. Initialize (Loads Job Data, Adapters)
        // This will update ctx.job and refresh ctx.execution
        await stepInitialize(ctx);

        updateProgress(0, "Dumping Database");
        // 2. Dump
        await stepExecuteDump(ctx);

        updateProgress(50, "Uploading Backup");
        // 3. Upload
        await stepUpload(ctx);

        updateProgress(90, "Applying Retention Policy");
        // 4. Retention
        await stepRetention(ctx);

        updateProgress(100, "Completed");
        ctx.status = "Success";
        log("Job completed successfully");

        // Final flush
        await flushLogs(executionId, true);

    } catch (error: any) {
        ctx.status = "Failed";
        log(`ERROR: ${error.message}`);
        console.error(`[Job ${jobId}] Execution failed:`, error);
        await flushLogs(executionId, true);
    } finally {
        // 4. Cleanup & Final Update (sets EndTime, Status in DB)
        await stepCleanup(ctx);
        await stepFinalize(ctx);

        // TRIGGER NEXT JOB
        processQueue().catch(e => console.error("Post-job queue trigger failed", e));
    }
}
