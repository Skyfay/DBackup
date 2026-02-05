import { RunnerContext } from "@/lib/runner/types";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
import { stepUpload } from "@/lib/runner/steps/03-upload";
import { stepRetention } from "@/lib/runner/steps/05-retention";
import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";
import prisma from "@/lib/prisma";
import { processQueue } from "@/lib/queue-manager";
import { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ module: "Runner" });

/**
 * Entry point for scheduling/running a job.
 * It now enqueues the job instead of running immediately.
 */
export async function runJob(jobId: string) {
    log.info("Enqueuing job", { jobId });

    try {
        const initialLog: LogEntry = {
            timestamp: new Date().toISOString(),
            level: "info",
            type: "general",
            message: "Job queued",
            stage: "Queued"
        };

        const execution = await prisma.execution.create({
            data: {
                jobId: jobId,
                status: "Pending",
                logs: JSON.stringify([initialLog]),
                metadata: JSON.stringify({ progress: 0, stage: "Queued" })
            }
        });

        // Trigger queue processing
        // We don't await this because we want to return the execution ID immediately to the UI
        processQueue().catch((e) => log.error("Queue trigger failed", {}, wrapError(e)));

        return { success: true, executionId: execution.id, message: "Job queued successfully" };

    } catch (error) {
        const wrapped = wrapError(error);
        log.error("Failed to enqueue job", { jobId }, wrapped);
        throw wrapped;
    }
}

/**
 * The actual execution logic (called by the Queue Manager).
 */
export async function performExecution(executionId: string, jobId: string) {
    const jobLog = logger.child({ module: "Runner", jobId, executionId });
    jobLog.info("Starting execution");

    // 1. Mark as RUNNING
    const initialExe = await prisma.execution.update({
        where: { id: executionId },
        data: {
            status: "Running",
            startedAt: new Date(), // Reset start time to actual run time
        },
        include: { job: true }
    });

    let currentProgress = 0;
    let currentStage = "Initializing";
    let lastLogUpdate = 0;

    // Declare ctx early
    let ctx = {
        execution: initialExe!,
        job: initialExe!.job!,
        log: (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
             const entry: LogEntry = {
                 timestamp: new Date().toISOString(),
                 level,
                 type,
                 message: msg,
                 details,
                 stage: currentStage
             };
             logs.push(entry);
             lastLogUpdate = Date.now();
        },
        updateProgress: async (p: number, s?: string) => {
            if (s) currentStage = s;
            currentProgress = p;
        }
    } as unknown as RunnerContext;

    // Parse logs and normalize to LogEntry[]
    const rawLogs: (string | LogEntry)[] = initialExe?.logs ? JSON.parse(initialExe.logs) : [];
    const logs: LogEntry[] = rawLogs.map(l => {
        if (typeof l === 'string') {
             const parts = l.split(": ");
             return {
                 timestamp: parts[0]?.length > 10 ? parts[0] : new Date().toISOString(),
                 level: "info",
                 type: "general",
                 message: parts.slice(1).join(": ") || l,
                 stage: "Legacy Log"
             };
        }
        return l;
    });

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
            } catch (error) {
                jobLog.error("Failed to flush logs", {}, wrapError(error));
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

    const logEntry = (message: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            type,
            message,
            stage: currentStage, // Uses the closure variable 'currentStage'
            details
        };

        jobLog.debug(message, { stage: currentStage, level });
        logs.push(entry);

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
        log: logEntry,
        updateProgress,
        status: "Running",
        startedAt: new Date(),
        execution: initialExe as any
    };

    try {
        logEntry("Taking job from queue...");

        // 1. Initialize (Loads Job Data, Adapters)
        // This will update ctx.job and refresh ctx.execution
        await stepInitialize(ctx);

        updateProgress(0, "Dumping Database");
        // 2. Dump
        await stepExecuteDump(ctx);

        // 3. Upload (Stage will be set inside stepUpload to correctly distinguish processing/uploading)
        await stepUpload(ctx);

        updateProgress(90, "Applying Retention Policy");
        // 4. Retention
        await stepRetention(ctx);

        updateProgress(100, "Completed");
        ctx.status = "Success";
        logEntry("Job completed successfully");

        // Final flush
        await flushLogs(executionId, true);

    } catch (error) {
        const wrapped = wrapError(error);
        ctx.status = "Failed";
        logEntry(`ERROR: ${wrapped.message}`);
        jobLog.error("Execution failed", {}, wrapped);
        await flushLogs(executionId, true);
    } finally {
        // 4. Cleanup & Final Update (sets EndTime, Status in DB)
        await stepCleanup(ctx);
        await stepFinalize(ctx);

        // TRIGGER NEXT JOB
        processQueue().catch((e) => log.error("Post-job queue trigger failed", {}, wrapError(e)));
    }
}
