import type { DashboardHealth, RunSummary, UnhealthyJob } from "./types";

const FINISHED_STATUSES = new Set(["Success", "Failed", "Partial", "Cancelled"]);
/** Runs that say whether a job works. A cancelled run was stopped, it neither passed nor failed. */
const OUTCOME_STATUSES = new Set(["Success", "Failed", "Partial"]);
const LIVE_STATUSES = new Set(["Running", "Pending"]);
const MAX_ERROR_LENGTH = 300;

export interface HealthJob {
    id: string;
    name: string;
    enabled: boolean;
    nextRunAt: string | null;
}

export function isLiveStatus(status: string): boolean {
    return LIVE_STATUSES.has(status);
}

/** The newest finished run, cancelled ones included. Expects runs newest first. */
export function latestFinishedRun(runs: RunSummary[]): RunSummary | null {
    return runs.find((run) => FINISHED_STATUSES.has(run.status)) ?? null;
}

/** The newest run that passed, failed or finished partially. Expects runs newest first. */
export function latestOutcome(runs: RunSummary[]): RunSummary | null {
    return runs.find((run) => OUTCOME_STATUSES.has(run.status)) ?? null;
}

/**
 * Puts the live runs of a job in front of its cached history, newest first.
 * History entries still marked as live are dropped: they finished after the cache was filled,
 * and until it refreshes their outcome is unknown.
 */
export function mergeRuns(history: RunSummary[], live: RunSummary[], limit: number): RunSummary[] {
    const liveIds = new Set(live.map((run) => run.id));
    const finished = history.filter((run) => !liveIds.has(run.id) && !isLiveStatus(run.status));
    return [...live, ...finished].slice(0, limit);
}

function toUnhealthyJob(job: HealthJob, runs: RunSummary[], trigger: RunSummary): UnhealthyJob {
    const outcomes = runs.filter((run) => OUTCOME_STATUSES.has(run.status));
    return {
        jobId: job.id,
        jobName: job.name,
        executionId: trigger.id,
        failedAt: trigger.startedAt,
        badRuns: outcomes.filter((run) => run.status === trigger.status).length,
        recentRuns: outcomes.length,
        lastSuccessAt: outcomes.find((run) => run.status === "Success")?.startedAt ?? null,
        error: null,
    };
}

/**
 * Decides what the banner at the top of the dashboard says.
 *
 * A job counts against health while it is enabled and its newest outcome failed or finished
 * partially. Cancelled runs are skipped: a failure followed by a cancelled run is still a failure.
 * Failures outrank partial runs, and within each group the most recent problem comes first.
 * Disabled jobs are left out so a paused job cannot keep the banner red.
 *
 * @param runsByJob Recent runs per job id, newest first.
 */
export function deriveHealth(jobs: HealthJob[], runsByJob: Map<string, RunSummary[]>): DashboardHealth {
    if (jobs.length === 0) return { state: "empty" };

    const failing: UnhealthyJob[] = [];
    const degraded: UnhealthyJob[] = [];
    let lastRunAt: string | null = null;

    for (const job of jobs) {
        const runs = runsByJob.get(job.id) ?? [];
        const finished = latestFinishedRun(runs);
        if (!finished) continue;

        const finishedAt = finished.endedAt ?? finished.startedAt;
        if (!lastRunAt || finishedAt > lastRunAt) lastRunAt = finishedAt;

        const outcome = latestOutcome(runs);
        if (!job.enabled || !outcome) continue;
        if (outcome.status === "Failed") failing.push(toUnhealthyJob(job, runs, outcome));
        else if (outcome.status === "Partial") degraded.push(toUnhealthyJob(job, runs, outcome));
    }

    const newestFirst = (a: UnhealthyJob, b: UnhealthyJob) => b.failedAt.localeCompare(a.failedAt);
    if (failing.length > 0) return { state: "failing", jobs: failing.sort(newestFirst) };
    if (degraded.length > 0) return { state: "degraded", jobs: degraded.sort(newestFirst) };

    const next = jobs
        .filter((job) => job.enabled && job.nextRunAt)
        .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];

    return {
        state: "healthy",
        lastRunAt,
        nextRun: next ? { jobName: next.name, at: next.nextRunAt! } : null,
    };
}

/** The message of the last error entry in an execution log, or null when there is none. */
export function extractLastError(logs: string | null | undefined): string | null {
    if (!logs) return null;

    let entries: unknown;
    try {
        entries = JSON.parse(logs);
    } catch {
        return null;
    }
    if (!Array.isArray(entries)) return null;

    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { level?: unknown; message?: unknown };
        if (entry?.level === "error" && typeof entry.message === "string" && entry.message.trim()) {
            const message = entry.message.trim();
            return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 3)}...` : message;
        }
    }
    return null;
}
