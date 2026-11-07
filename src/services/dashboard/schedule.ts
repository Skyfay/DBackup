import { zoneReader, type ScheduleReader } from "@/lib/core/cron-window";
import { DEFAULT_RUN_MS, findConflicts, type PlannedRun } from "@/lib/core/schedule-conflicts";
import type { RunSummary, ScheduleConflict, UpcomingJob, UpcomingRun, UpcomingSchedule } from "./types";

/** The longest range the card offers. The 12 and 24 hour views are cut from it in the browser. */
export const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Every five minutes over the window. A job that runs more often is cut off and flagged as truncated. */
export const MAX_RUNS_PER_JOB = 576;

export interface ScheduledJob {
    id: string;
    name: string;
    /** The effective cron expression, preset or own. Only enabled jobs with a schedule are passed in. */
    schedule: string;
}

/** The runs of a job in the window, at most `MAX_RUNS_PER_JOB`, and whether it has more there. */
export interface JobDueTimes {
    times: number[];
    truncated: boolean;
}

export interface UpcomingOptions {
    /**
     * The runs of the jobs worked out already, like from the plan of the queue, by job id. Null for
     * an expression that never runs. A job left out is read here.
     */
    due?: (job: ScheduledJob) => JobDueTimes | null | undefined;
    /**
     * Runs of jobs that are not listed, like those of other tenants, which share the queue. They
     * count toward an overlap, and only an overlap that a listed run falls into is kept.
     */
    others?: PlannedRun[];
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
 * How the card reads the schedules over the window: in the scheduler's time zone, as croner reads
 * an expression, at a fixed offset while the zone keeps one, see `zoneReader`.
 */
export function upcomingReader(timezone: string, now: Date): ScheduleReader {
    return zoneReader(timezone, now.getTime(), now.getTime() + UPCOMING_WINDOW_MS, "croner");
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
    options: UpcomingOptions = {},
): UpcomingSchedule {
    const windowEnd = now.getTime() + UPCOMING_WINDOW_MS;
    const upcomingJobs: UpcomingJob[] = [];
    const runs: (UpcomingRun & { estimatedMs: number })[] = [];
    let truncated = false;
    let read: ScheduleReader | null = null;

    for (const job of jobs) {
        let due = options.due?.(job);
        if (due === undefined) {
            read ??= upcomingReader(timezone, now);
            // One more than the cap tells whether the job has runs beyond it.
            const times = read(job.schedule, MAX_RUNS_PER_JOB + 1);
            due = times ? { times: times.slice(0, MAX_RUNS_PER_JOB), truncated: times.length > MAX_RUNS_PER_JOB } : null;
        }
        // An invalid expression never runs.
        if (!due || due.times.length === 0) continue;
        if (due.truncated) truncated = true;

        const estimatedMs = estimateDuration(runsByJob.get(job.id) ?? []);
        upcomingJobs.push({ id: job.id, name: job.name, estimatedMs, likelyToFail: failingJobIds.has(job.id) });
        for (const time of due.times) {
            runs.push({ jobId: job.id, at: new Date(time).toISOString(), estimatedMs });
        }
    }

    runs.sort((a, b) => a.at.localeCompare(b.at) || a.jobId.localeCompare(b.jobId));

    const listed = runs.map((run) => ({ start: Date.parse(run.at), durationMs: run.estimatedMs }));
    const others = options.others ?? [];
    let windows = findConflicts(others.length > 0 ? [...listed, ...others] : listed, slots);
    if (others.length > 0) {
        // An overlap among runs of other jobs alone says nothing about the listed ones.
        const spans = listed.map((run) => ({ from: run.start, to: run.start + Math.max(run.durationMs, 1) }));
        windows = windows.filter((conflict) => spans.some((span) => span.from < conflict.to && span.to > conflict.from));
    }
    const conflicts: ScheduleConflict[] = windows.map((conflict) => ({
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
