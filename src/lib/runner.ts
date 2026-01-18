import { RunnerContext } from "@/lib/runner/types";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
import { stepUpload } from "@/lib/runner/steps/03-upload";
import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";
import prisma from "@/lib/prisma";

export async function runJob(jobId: string) {
    console.log(`[Runner] Starting execution for Job ID: ${jobId}`);

    let currentProgress = 0;
    let currentStage = "Initializing";
    let lastLogUpdate = 0; // Initialize to 0 to ensure first log flushes immediately
    let executionId: string | null = null;

    // Declare ctx early so updateProgress can reference it
    let ctx: RunnerContext;

    const logs: string[] = [];

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

        // Function to perform the actual update
        const performUpdate = async () => {
             try {
                // Update timestamp BEFORE await to throttle subsequent calls immediately
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

            // If another flush was requested while we were busy, do it now (once)
            if (hasPendingFlush) {
                hasPendingFlush = false;
                // recursive call but deferred? Or just loop?
                // Simple recursion is fine as it's async and guarded by isFlushing=false (set in finally)
                // actually we are inside the first call's stack.
                // Better: iterate or just call again.
                // Let's just run one 'catch-up' update.
                 await performUpdate();
            }
        } finally {
            isFlushing = false;
        }
    };

    const log = (msg: string) => {
        // We might not have the job name yet, so we use a generic prefix or ID
        console.log(`[Job ${jobId}] ${msg}`);
        logs.push(`${new Date().toISOString()}: ${msg}`);
        if (executionId) {
            flushLogs(executionId);
        }
    };

    const updateProgress = (percent: number, stage?: string) => {
        currentProgress = percent;
        if (stage) currentStage = stage;

        // Update context metadata so finalization has the latest state
        if (ctx) {
            ctx.metadata = { ...ctx.metadata, progress: currentProgress, stage: currentStage };
        }

        if (executionId) {
            flushLogs(executionId);
        }
    };

    ctx = {
        jobId,
        logs,
        log,
        updateProgress,
        status: "Success", // Optimistic default
        startedAt: new Date()
    };

    try {
        // 1. Initialization (DB Fetch, Validation, Execution Record)
        // Must be awaited to get Execution ID
        await stepInitialize(ctx);

        if (!ctx.execution) {
            throw new Error("Execution record was not created during initialization");
        }

        executionId = ctx.execution.id;

        // Start background process
        (async () => {
            try {
                updateProgress(0, "Dumping Database");
                // 2. Dump
                await stepExecuteDump(ctx);

                updateProgress(50, "Uploading Backup");
                // 3. Upload
                await stepUpload(ctx);

                updateProgress(100, "Completed");
                ctx.status = "Success";
                log("Job completed successfully");

            } catch (error: any) {
                ctx.status = "Failed";
                log(`ERROR: ${error.message}`);
                console.error(`[Job ${jobId}] Execution failed:`, error);
            } finally {
                // 4. Cleanup & Final Update
                await stepCleanup(ctx);
                await stepFinalize(ctx);
            }
        })();

        // Return immediately with Execution ID
        return { success: true, executionId, message: "Backup started successfully" };

    } catch (error: any) {
        // Initialization failed
        ctx.status = "Failed";
        log(`ERROR: ${error.message}`);
        console.error(`[Job ${jobId}] Init failed:`, error);

        // Try to update execution if it exists (e.g. init failed at step 3 of init)
        if (ctx.execution) {
             await stepFinalize(ctx);
        }

        // Return failure but structured (so API can handle it) or throw?
        // Existing callers expect validation errors to throw usually.
        // But since we changed signature, let's keep consistency.
        throw error;
    }
}
