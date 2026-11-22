import prisma from "@/lib/prisma";
import { abortExecution } from "@/lib/execution/abort";
import { LEADING_RUNS, endFollowers, endOrphanedFollowers } from "@/lib/execution/follower-runs";
import { HEARTBEAT_KEY } from "@/lib/execution/log-flusher";
import { processQueue } from "@/lib/execution/queue-manager";
import { LogEntry } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "StuckExecutionService" });

/** System setting holding the no-progress timeout, in minutes. `0` disables the watchdog. */
export const STUCK_TIMEOUT_SETTING = "execution.stuckTimeoutMinutes";

/** Six hours. Longer than any healthy backup that reports progress, short enough to matter. */
export const DEFAULT_STUCK_TIMEOUT_MINUTES = 360;

/**
 * System setting holding the longest a run may hold its slot, in minutes, progress or not. `0`
 * turns it off. A source that trickles a byte now and then reports progress and never counts as
 * stuck, so without this a run of one tenant could hold the slot of every tenant for as long as
 * its server keeps it alive.
 */
export const MAX_RUN_SETTING = "execution.maxRunMinutes";

/** One day. Far longer than a healthy backup, short enough that a trickling one ends. */
export const DEFAULT_MAX_RUN_MINUTES = 1440;

export interface StuckExecutionSweep {
    checked: number;
    cancelled: number;
}

async function minutesOf(key: string, fallback: number): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) return fallback;

    const parsed = Number.parseInt(setting.value, 10);
    // A malformed value must not silently disable the safety net it configures.
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

const getTimeoutMinutes = () => minutesOf(STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES);
const getMaxRunMinutes = () => minutesOf(MAX_RUN_SETTING, DEFAULT_MAX_RUN_MINUTES);

/**
 * The moment an execution last showed a sign of life.
 *
 * Falls back to its start time, which covers a run that died before its first progress write
 * and a row written by a version that did not record a heartbeat yet.
 */
function lastProgressAt(execution: { metadata: string | null; startedAt: Date }): Date {
    if (execution.metadata) {
        try {
            const parsed = JSON.parse(execution.metadata) as Record<string, unknown>;
            const beat = parsed[HEARTBEAT_KEY];
            if (typeof beat === "string") {
                const at = new Date(beat);
                if (!Number.isNaN(at.getTime())) return at;
            }
        } catch {
            // Unparseable metadata is treated as no heartbeat at all.
        }
    }
    return execution.startedAt;
}

/** Appends a closing line to an execution's stored log, leaving a reason behind in the UI. */
function withFinalLog(rawLogs: string, message: string): string {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "error",
        type: "general",
        message,
        stage: "Failed",
    };

    try {
        const parsed = JSON.parse(rawLogs);
        if (Array.isArray(parsed)) return JSON.stringify([...parsed, entry]);
    } catch {
        // Fall through - a log we cannot parse is replaced by one that explains itself.
    }
    return JSON.stringify([entry]);
}

/**
 * Fails executions that stopped making progress, so one of them cannot hold the queue shut.
 *
 * The queue counts every `Running` row against `maxConcurrentJobs`, which defaults to 1. A run
 * blocked on a source that stopped answering therefore does not just fail to finish - it
 * silently stops every scheduled backup after it, with nothing in the interface saying why.
 * That is the failure this exists to prevent.
 *
 * Progress, not age, is the measure. A twelve-hour backup that is still transferring files
 * updates its heartbeat throughout and is left alone; a five-minute one that stopped reporting
 * is not.
 *
 * Covers only a live process. Rows left behind by one that was killed outright are handled at
 * startup by `recoverStaleExecutions` in `src/lib/execution/recovery.ts`.
 */
export async function sweepStuckExecutions(): Promise<StuckExecutionSweep> {
    const timeoutMinutes = await getTimeoutMinutes();
    const maxRunMinutes = await getMaxRunMinutes();
    if (timeoutMinutes === 0 && maxRunMinutes === 0) {
        log.debug("Stuck execution watchdog disabled");
        return { checked: 0, cancelled: 0 };
    }

    // A run that follows another one makes no progress of its own. It ends with the run it follows,
    // or here once that run is gone or ended without it.
    await endOrphanedFollowers();
    const running = await prisma.execution.findMany({
        where: { status: "Running", AND: [LEADING_RUNS] },
        select: { id: true, jobId: true, metadata: true, logs: true, startedAt: true },
    });

    const cutoff = Date.now() - timeoutMinutes * 60_000;
    const oldest = Date.now() - maxRunMinutes * 60_000;
    let cancelled = 0;

    for (const execution of running) {
        const idleSince = lastProgressAt(execution);
        const idle = timeoutMinutes > 0 && idleSince.getTime() <= cutoff;
        const tooLong = maxRunMinutes > 0 && execution.startedAt.getTime() <= oldest;
        if (!idle && !tooLong) continue;

        const idleMinutes = Math.round((Date.now() - idleSince.getTime()) / 60_000);
        log.warn(idle ? "Cancelling execution with no progress" : "Cancelling execution that ran longer than a run may", {
            executionId: execution.id,
            jobId: execution.jobId,
            idleMinutes,
            timeoutMinutes,
            maxRunMinutes,
        });

        // Signalled first: a run that is between steps unwinds properly, closing its
        // connections and clearing its temp files, rather than being declared dead underneath
        // itself. The row is corrected either way, because a signal reaches nothing at all
        // when the run belongs to a process that is already gone.
        abortExecution(execution.id);

        const message = idle
            ? `No progress for ${idleMinutes} minute(s), cancelled by the stuck execution watchdog (threshold ${timeoutMinutes} minute(s)).`
            : `Ran longer than ${maxRunMinutes} minute(s), the longest a run may take, cancelled by the stuck execution watchdog.`;

        // Conditional on the status so a run finishing in this exact moment is not overwritten.
        const updated = await prisma.execution.updateMany({
            where: { id: execution.id, status: "Running" },
            data: {
                status: "Failed",
                endedAt: new Date(),
                logs: withFinalLog(execution.logs, message),
            },
        });

        if (updated.count > 0) {
            cancelled++;
            await endFollowers(execution.id, "Failed");
        }
    }

    if (cancelled > 0) {
        // The slots are free now, and whatever was queued behind the stuck run should start
        // without waiting for the next scheduler tick.
        processQueue().catch((e) => log.error("Queue trigger after watchdog sweep failed", {}, wrapError(e)));
    }

    return { checked: running.length, cancelled };
}
