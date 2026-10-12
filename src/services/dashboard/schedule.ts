import { Cron } from "croner";
import { DEFAULT_RUN_MS, findConflicts } from "@/lib/core/schedule-conflicts";
import type { RunSummary, ScheduleConflict, UpcomingJob, UpcomingRun, UpcomingSchedule } from "./types";

/** The longest range the card offers. The 12 and 24 hour views are cut from it in the browser. */
export const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Every five minutes over the window. A job that runs more often is cut off and flagged as truncated. */
const MAX_RUNS_PER_JOB = 576;

export interface ScheduledJob {
    id: string;
    name: string;
    /** The effective cron expression, preset or own. Only enabled jobs with a schedule are passed in. */
    schedule: string;
}

/** Average length of a job's finished runs. Cancelled runs say nothing about how long a run takes. */
export function estimateDuration(runs: RunSummary[]): number {
    const durations = runs
        .filter((run) => run.endedAt && run.status !== "Cancelled")
        .map((run) => new Date(run.endedAt!).getTime() - new Date(run.startedAt).getTime())
        .filter((ms) => ms > 0);
    if (durations.length === 0) return DEFAULT_RUN_MS;
    return Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length);
}

/**
 * The runs of `cron` after `from` up to `until`, at most `limit` of them. Counting stops at the
 * end of the window, so an hourly job costs 48 steps and not the cap of a job that runs every
 * five minutes. Each step of a cron in a named time zone takes about 0.1 ms.
 */
function runsUntil(cron: Cron, from: Date, until: number, limit: number): Date[] {
    const times: Date[] = [];
    let previous: Date | null = from;
    while (times.length < limit) {
        previous = cron.nextRun(previous);
        if (!previous || previous.getTime() > until) break;
        times.push(previous);
    }
    return times;
}

/**
 * The runs due in the next 48 hours and where they would queue up.
 *
 * @param runsByJob Recent runs per job, the basis for each job's estimated duration.
 * @param failingJobIds Jobs whose newest finished run failed. Their upcoming runs are flagged.
 */
export function buildUpcomingSchedule(
    jobs: ScheduledJob[],
    runsByJob: Map<string, RunSummary[]>,
    failingJobIds: Set<string>,
    slots: number,
    timezone: string,
    now: Date,
): UpcomingSchedule {
    const windowEnd = now.getTime() + UPCOMING_WINDOW_MS;
    const upcomingJobs: UpcomingJob[] = [];
    const runs: (UpcomingRun & { estimatedMs: number })[] = [];
    let truncated = false;

    for (const job of jobs) {
        let due: Date[];
        try {
            // One more than the cap tells whether the job has runs beyond it.
            due = runsUntil(new Cron(job.schedule, { timezone }), now, windowEnd, MAX_RUNS_PER_JOB + 1);
        } catch {
            // An invalid expression never runs.
            continue;
        }

        if (due.length === 0) continue;
        if (due.length > MAX_RUNS_PER_JOB) truncated = true;

        const estimatedMs = estimateDuration(runsByJob.get(job.id) ?? []);
        upcomingJobs.push({ id: job.id, name: job.name, estimatedMs, likelyToFail: failingJobIds.has(job.id) });
        for (const time of due.slice(0, MAX_RUNS_PER_JOB)) {
            runs.push({ jobId: job.id, at: time.toISOString(), estimatedMs });
        }
    }

    runs.sort((a, b) => a.at.localeCompare(b.at) || a.jobId.localeCompare(b.jobId));

    const conflicts: ScheduleConflict[] = findConflicts(
        runs.map((run) => ({ start: Date.parse(run.at), durationMs: run.estimatedMs })),
        slots,
    ).map((conflict) => ({
        from: new Date(conflict.from).toISOString(),
        to: new Date(conflict.to).toISOString(),
        demand: conflict.demand,
    }));

    return {
        windowStart: now.toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        slots,
        jobs: upcomingJobs,
        runs: runs.map(({ jobId, at }) => ({ jobId, at })),
        conflicts,
        truncated,
    };
}
