import { Cron } from "croner";
import type { RunSummary, ScheduleConflict, UpcomingJob, UpcomingRun, UpcomingSchedule } from "./types";

/** The longest range the card offers. The 12 and 24 hour views are cut from it in the browser. */
export const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Every five minutes over the window. A job that runs more often is cut off and flagged as truncated. */
const MAX_RUNS_PER_JOB = 576;
/** Assumed length of a run for a job without any finished run to learn from. */
const DEFAULT_DURATION_MS = 60_000;

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
    if (durations.length === 0) return DEFAULT_DURATION_MS;
    return Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length);
}

/**
 * Windows in which more runs would be active than the queue has slots. Each run counts from its
 * start for its estimated duration. The extra runs wait in the queue, so a conflict means delay.
 */
export function findConflicts(
    runs: { start: number; durationMs: number }[],
    slots: number,
): { from: number; to: number; demand: number }[] {
    const events: [time: number, delta: number][] = [];
    for (const run of runs) {
        events.push([run.start, 1]);
        events.push([run.start + Math.max(run.durationMs, 1), -1]);
    }
    // Ends sort before starts at the same instant, so back-to-back runs do not overlap.
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const conflicts: { from: number; to: number; demand: number }[] = [];
    let active = 0;
    let current: { from: number; to: number; demand: number } | null = null;

    for (const [time, delta] of events) {
        active += delta;
        if (active > slots) {
            if (current) current.demand = Math.max(current.demand, active);
            else current = { from: time, to: time, demand: active };
        } else if (current) {
            current.to = time;
            conflicts.push(current);
            current = null;
        }
    }
    return conflicts;
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
        let times: Date[];
        try {
            // One more than the cap tells whether the job has runs beyond it.
            times = new Cron(job.schedule, { timezone }).nextRuns(MAX_RUNS_PER_JOB + 1, now);
        } catch {
            // An invalid expression never runs.
            continue;
        }

        const due = times.filter((time) => time.getTime() <= windowEnd);
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
