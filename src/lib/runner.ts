import { RunnerContext } from "@/lib/runner/types";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
import { stepUpload } from "@/lib/runner/steps/03-upload";
import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";

export async function runJob(jobId: string) {
    console.log(`[Runner] Starting execution for Job ID: ${jobId}`);

    const logs: string[] = [];
    const log = (msg: string) => {
        // We might not have the job name yet, so we use a generic prefix or ID
        console.log(`[Job ${jobId}] ${msg}`);
        logs.push(`${new Date().toISOString()}: ${msg}`);
    };

    const ctx: RunnerContext = {
        jobId,
        logs,
        log,
        status: "Success", // Optimistic default, changes on error
        startedAt: new Date()
    };

    try {
        // 1. Initialization (DB Fetch, Validation, Execution Record)
        await stepInitialize(ctx);

        // Update logger to include job name if available now
        if (ctx.job) {
             // We can't easily change the closure 'log' function but variables are by reference
             // Just continue logging
        }

        // 2. Dump
        await stepExecuteDump(ctx);

        // 3. Upload
        await stepUpload(ctx);

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

    return { status: ctx.status, logs: ctx.logs };
}
