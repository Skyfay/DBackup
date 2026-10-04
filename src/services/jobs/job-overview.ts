import { Cron } from "croner";
import prisma from "@/lib/prisma";
import { RUNS_PER_JOB, getRecentRunsByJob, getSchedulerTimezone, toRunSummary } from "@/services/dashboard/aggregates";
import { cached } from "@/services/dashboard/cache";
import { extractLastError, latestFinishedRun, mergeRuns } from "@/services/dashboard/health";
import type { RunSummary } from "@/services/dashboard/types";

/** A run that is still going, with how far it got. */
export interface LiveRun {
    executionId: string;
    status: "Running" | "Pending";
    startedAt: string;
    /** The pipeline stage, like "Uploading". Null until the run reports one. */
    stage: string | null;
    /** From 0 to 100. */
    progress: number | null;
}

/** How a job is doing, for the lists on the Jobs page. */
export interface JobOverview {
    /** Running or Pending while a run is live, otherwise the status of the last finished run. Null before the first run. */
    status: string | null;
    /** The latest runs, oldest first, the live one included. */
    runs: RunSummary[];
    /** The newest run, live or finished. */
    lastRun: RunSummary | null;
    /** What went wrong in the last finished run, when it failed or finished partially. */
    error: string | null;
    live: LiveRun | null;
    nextRunAt: string | null;
}

export interface ScheduledJob {
    id: string;
    enabled: boolean;
    schedule: string;
    schedulePreset?: { schedule: string } | null;
}

/** A finished run never changes, so the error line read from its log is kept for a while. */
const ERROR_TTL_MS = 10 * 60 * 1000;

function effectiveSchedule(job: ScheduledJob): string {
    return (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
}

/** When a job runs next, in the scheduler's time zone. Null for a paused job or one it cannot read. */
export function nextRunOf(job: ScheduledJob, timezone: string, from?: Date): string | null {
    const schedule = effectiveSchedule(job);
    if (!job.enabled || !schedule) return null;
    try {
        return new Cron(schedule, { timezone }).nextRun(from)?.toISOString() ?? null;
    } catch {
        // An invalid expression never runs, so there is no next run to show.
        return null;
    }
}

/** The stage and progress a live run keeps in its metadata. */
export function liveProgress(metadata: string | null): { stage: string | null; progress: number | null } {
    if (!metadata) return { stage: null, progress: null };
    try {
        const value = JSON.parse(metadata) as { stage?: unknown; progress?: unknown };
        return {
            stage: typeof value.stage === "string" && value.stage ? value.stage : null,
            progress: typeof value.progress === "number" && Number.isFinite(value.progress) ? Math.max(0, Math.min(100, Math.round(value.progress))) : null,
        };
    } catch {
        return { stage: null, progress: null };
    }
}

function errorOf(executionId: string): Promise<string | null> {
    return cached(
        `run-error:${executionId}`,
        ERROR_TTL_MS,
        async () => {
            const execution = await prisma.execution.findUnique({ where: { id: executionId }, select: { logs: true } });
            return extractLastError(execution?.logs);
        },
        { survivesInvalidation: true },
    );
}

/**
 * How each job is doing: its latest runs, the one going on right now, what went wrong last and
 * when it runs next. The history comes from the cache the dashboard shares, the live runs are
 * read on every call, so a started run shows up right away.
 */
export async function getJobOverviews(jobs: ScheduledJob[], now = new Date()): Promise<Map<string, JobOverview>> {
    if (jobs.length === 0) return new Map();

    const [history, liveExecutions, timezone] = await Promise.all([
        getRecentRunsByJob(),
        prisma.execution.findMany({
            where: { type: "Backup", status: { in: ["Running", "Pending"] }, jobId: { in: jobs.map((job) => job.id) } },
            orderBy: { startedAt: "desc" },
            select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true, metadata: true },
        }),
        getSchedulerTimezone(),
    ]);

    const liveByJob = new Map<string, typeof liveExecutions>();
    for (const execution of liveExecutions) {
        if (!execution.jobId) continue;
        liveByJob.set(execution.jobId, [...(liveByJob.get(execution.jobId) ?? []), execution]);
    }

    const entries = await Promise.all(jobs.map(async (job): Promise<[string, JobOverview]> => {
        const live = liveByJob.get(job.id) ?? [];
        const runs = mergeRuns(history[job.id] ?? [], live.map(toRunSummary), RUNS_PER_JOB);
        const current = live.find((run) => run.status === "Running") ?? live[0];
        const finished = latestFinishedRun(runs);
        const failed = finished && (finished.status === "Failed" || finished.status === "Partial") ? finished : null;

        return [job.id, {
            status: current?.status ?? finished?.status ?? null,
            runs: [...runs].reverse(),
            lastRun: runs[0] ?? null,
            error: failed ? await errorOf(failed.id) : null,
            live: current
                ? {
                    executionId: current.id,
                    status: current.status === "Pending" ? "Pending" : "Running",
                    startedAt: current.startedAt.toISOString(),
                    ...liveProgress(current.metadata),
                }
                : null,
            nextRunAt: nextRunOf(job, timezone, now),
        }];
    }));

    return new Map(entries);
}
