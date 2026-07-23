import { RunnerContext } from "@/lib/runner/types";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import { stepExecuteDump } from "@/lib/runner/steps/02-dump";
import { stepUpload } from "@/lib/runner/steps/03-upload";
import { stepRetention } from "@/lib/runner/steps/05-retention";
import { stepCleanup, stepFinalize } from "@/lib/runner/steps/04-completion";
import prisma from "@/lib/prisma";
import { processQueue } from "@/lib/execution/queue-manager";
import { LogEntry, LogLevel, LogType, PipelineStage, PIPELINE_STAGES, stageProgress } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { registerExecution, unregisterExecution } from "@/lib/execution/abort";
import { formatDuration } from "@/lib/utils";

const log = logger.child({ module: "Runner" });

export interface TriggerInfo {
    type: "Manual" | "Scheduler" | "Api";
    label: string;
}

export interface RunJobOptions {
    lock?: boolean;
}

/**
 * Entry point for scheduling/running a job.
 * It now enqueues the job instead of running immediately.
 */
export async function runJob(jobId: string, triggerInfo?: TriggerInfo, options?: RunJobOptions) {
    log.info("Enqueuing job", { jobId, triggerType: triggerInfo?.type, lock: options?.lock });

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
                metadata: JSON.stringify({ progress: 0, stage: "Queued", ...(options?.lock ? { lock: true } : {}) }),
                triggerType: triggerInfo?.type ?? null,
                triggerLabel: triggerInfo?.label ?? null,
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

    // Atomically claim the execution: transition Pending → Running only if it is
    // still Pending. When two jobs are scheduled at the same cron minute, two
    // concurrent processQueue() calls can both "see" the same Pending execution
    // before either has updated it. The updateMany condition ensures only one
    // caller proceeds; the other sees count=0 and bails out.
    const claimed = await prisma.execution.updateMany({
        where: { id: executionId, status: "Pending" },
        data: { status: "Running", startedAt: new Date() }
    });

    if (claimed.count === 0) {
        jobLog.warn("Execution already claimed by a concurrent call - skipping duplicate run");
        return;
    }

    // Set up cancellation
    const abortController = registerExecution(executionId);

    // Fetch full execution data (including job relation) after claiming
    const initialExe = await prisma.execution.findUnique({
        where: { id: executionId },
        include: { job: true }
    });

    if (!initialExe) {
        jobLog.error("Execution record not found after claiming", { executionId });
        unregisterExecution(executionId);
        return;
    }

    let currentProgress = 0;
    let currentStage = "Initializing";
    let currentDetail = "";
    let lastLogUpdate = 0;
    const stageStartTimes = new Map<string, number>();

    // Declare ctx early
    let ctx = {
        execution: initialExe!,
        job: initialExe!.job!,
        destinations: [],
        /* v8 ignore start */
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
        },
        /* v8 ignore next 3 */
        setStage: (_stage: PipelineStage) => {},
        updateDetail: (_detail: string) => {},
        updateStageProgress: (_percent: number) => {},
        /* v8 ignore end */
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
                        metadata: JSON.stringify({ progress: currentProgress, stage: currentStage, detail: currentDetail })
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
        currentDetail = ""; // Clear detail on legacy updateProgress calls
        if (ctx) ctx.metadata = { ...ctx.metadata, progress: currentProgress, stage: currentStage };
        flushLogs(executionId);
    };

    /** Set the active pipeline stage. Automatically logs stage transition with duration. */
    const setStage = (stage: PipelineStage) => {
        // Finalize previous stage with duration
        const prevStart = stageStartTimes.get(currentStage);
        if (prevStart && currentStage !== stage) {
            const durationMs = Date.now() - prevStart;
            const entry: LogEntry = {
                timestamp: new Date().toISOString(),
                level: "success",
                type: "general",
                message: `${currentStage} completed (${formatDuration(durationMs)})`,
                stage: currentStage,
                durationMs,
            };
            logs.push(entry);
        }

        currentStage = stage;
        currentDetail = "";
        stageStartTimes.set(stage, Date.now());
        currentProgress = stageProgress(stage, 0);
        if (ctx) ctx.metadata = { ...ctx.metadata, progress: currentProgress, stage: currentStage, detail: currentDetail };
        flushLogs(executionId);
    };

    /** Update the live detail text without changing the stage (e.g. "125.5 MB dumped...") */
    const updateDetail = (detail: string) => {
        currentDetail = detail;
        if (ctx) ctx.metadata = { ...ctx.metadata, detail: currentDetail };
        flushLogs(executionId);
    };

    /** Update internal progress within the current stage (0–100) → maps to global progress */
    const updateStageProgress = (internalPercent: number) => {
        currentProgress = stageProgress(currentStage as PipelineStage, internalPercent);
        if (ctx) ctx.metadata = { ...ctx.metadata, progress: currentProgress };
        flushLogs(executionId);
    };

    // Read lock option stored in the initial metadata at enqueue time.
    // The metadata field is later overwritten with live progress, so we
    // capture the value here before the flush loop takes over.
    const initialMetadataParsed: Record<string, unknown> = initialExe.metadata
        ? JSON.parse(initialExe.metadata)
        : {};
    const lockBackup = initialMetadataParsed.lock === true;

    // Create Context
    // We cast initialExe to any because Prisma types might mismatch RunnerContext expectation slightly,
    // but stepInitialize usually overwrites/fixes it.
    ctx = {
        jobId,
        logs,
        log: logEntry,
        updateProgress,
        setStage,
        updateDetail,
        updateStageProgress,
        status: "Running",
        startedAt: new Date(),
        execution: initialExe as any,
        destinations: [],
        sources: [],
        abortSignal: abortController.signal,
        triggerInfo: initialExe.triggerType ? {
            type: initialExe.triggerType,
            label: initialExe.triggerLabel ?? "Unknown",
        } : undefined,
        lock: lockBackup,
    };

    // Helper: throw if cancellation was requested
    const checkCancelled = () => {
        if (abortController.signal.aborted) {
            throw new Error("Execution was cancelled by user");
        }
    };

    try {
        logEntry("Taking job from queue...");

        // 1. Initialize (Loads Job Data, Adapters)
        // This will update ctx.job and refresh ctx.execution
        setStage(PIPELINE_STAGES.INITIALIZING);
        await stepInitialize(ctx);
        checkCancelled();

        // 2. Dump. The stage is set inside stepExecuteDump, which knows whether it is
        // dumping databases, collecting files, or both - so a file-only backup no longer
        // reports "Dumping Databases".
        await stepExecuteDump(ctx);
        checkCancelled();

        // 3. Upload (stepUpload sets PROCESSING / UPLOADING / VERIFYING stages internally)
        await stepUpload(ctx);
        checkCancelled();

        // 4. Retention
        setStage(PIPELINE_STAGES.RETENTION);
        await stepRetention(ctx);

        setStage(PIPELINE_STAGES.COMPLETED);
        // Upload step may have set status to "Partial" - preserve it
        if (ctx.status === "Running") {
            ctx.status = "Success";
        }
        logEntry(ctx.status === "Partial" ? "Job completed with partial success" : "Job completed successfully");

        // Final flush
        await flushLogs(executionId, true);

    } catch (error) {
        const wrapped = wrapError(error);
        // Distinguish cancellation from real failures
        if (abortController.signal.aborted) {
            ctx.status = "Cancelled";
            logEntry("Execution was cancelled by user", "warning");
            jobLog.info("Execution cancelled by user");
        } else {
            ctx.status = "Failed";
            logEntry(`ERROR: ${wrapped.message}`);
            jobLog.error("Execution failed", {}, wrapped);
        }
        await flushLogs(executionId, true);
    } finally {
        // Remove from running executions map
        unregisterExecution(executionId);

        // 4. Cleanup & Final Update (sets EndTime, Status in DB)
        await stepCleanup(ctx);
        await stepFinalize(ctx);

        // TRIGGER NEXT JOB
        processQueue().catch((e) => log.error("Post-job queue trigger failed", {}, wrapError(e)));
    }
}
