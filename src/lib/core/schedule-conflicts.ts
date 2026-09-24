import { readCron } from "./cron";

/** A run as the queue sees it: when it starts and how long it is expected to take. */
export interface PlannedRun {
    start: number;
    durationMs: number;
}

/** A stretch of time in which more runs want to be active than the queue has slots. */
export interface ConflictWindow {
    from: number;
    to: number;
    /** Runs active at once at the peak of the window. */
    demand: number;
}

/**
 * Windows in which more runs would be active than the queue has slots. Each run counts from its
 * start for its estimated duration. The extra runs wait in the queue, so a conflict means delay.
 */
export function findConflicts(runs: PlannedRun[], slots: number): ConflictWindow[] {
    const events: [time: number, delta: number][] = [];
    for (const run of runs) {
        events.push([run.start, 1]);
        events.push([run.start + Math.max(run.durationMs, 1), -1]);
    }
    // Ends sort before starts at the same instant, so back-to-back runs do not overlap.
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const conflicts: ConflictWindow[] = [];
    let active = 0;
    let current: ConflictWindow | null = null;

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

/** A job the scheduler runs, with when and for how long, from GET /api/jobs/schedules. */
export interface ScheduledJobLoad {
    id: string;
    name: string;
    /** The effective expression, the preset's when the job follows one. */
    schedule: string;
    presetId: string | null;
    estimatedMs: number;
}

/** What the queue already has to do, and how many runs it takes at once. */
export interface ScheduleLoad {
    timezone: string;
    slots: number;
    jobs: ScheduledJobLoad[];
}

/**
 * The jobs that start on the schedule being picked: the job itself, or every job that follows the
 * preset being edited. They are left out of the other jobs and start together.
 */
export interface ScheduleOwners {
    ids: string[];
    /** One estimated duration per job that starts on the schedule. */
    durations: number[];
}

export interface ScheduleClash {
    /** The first start that has to share the queue. */
    at: Date;
    /** Every start checked has to share it, like a daily time that meets another daily job. */
    everyRun: boolean;
    /** The other jobs running then. Empty when only the jobs of one preset meet each other. */
    others: string[];
    /** How long more runs want a slot than there are, about how long one of them waits. */
    overlapMs: number;
}

/** Assumed length of a run for a job without any finished run to learn from. */
export const DEFAULT_RUN_MS = 60_000;
const HORIZON_MS = 8 * 24 * 60 * 60 * 1000;
const MIN_STARTS = 3;
const MAX_STARTS = 200;
/** Runs of one other job looked at around one start. Only a job that runs every few minutes has more. */
const MAX_NEARBY = 20;

function startsOf(expression: string, timezone: string, now: Date): number[] | null {
    const cron = readCron(expression, timezone);
    if (!cron) return null;
    const end = now.getTime() + HORIZON_MS;
    const starts: number[] = [];
    let from = now;
    while (starts.length < MAX_STARTS) {
        const next = cron.nextRun(from);
        if (!next || (next.getTime() > end && starts.length >= MIN_STARTS)) break;
        starts.push(next.getTime());
        from = next;
    }
    return starts;
}

/**
 * Whether runs on this schedule would wait for a free slot, by the rule the Overview uses to mark
 * overlapping runs. Nothing is reported while the slots are enough, however many jobs start at the
 * same time. Looks at the starts of the next eight days, and at least at the next three.
 */
export function findScheduleClash(expression: string, load: ScheduleLoad, owners: ScheduleOwners, now = new Date()): ScheduleClash | null {
    const starts = startsOf(expression, load.timezone, now);
    if (!starts || starts.length === 0) return null;

    const durations = owners.durations.length > 0 ? owners.durations : [DEFAULT_RUN_MS];
    const longest = Math.max(...durations);
    const others = load.jobs.flatMap((job) => {
        if (owners.ids.includes(job.id)) return [];
        const cron = readCron(job.schedule, load.timezone);
        return cron ? [{ job, cron }] : [];
    });

    // Only the runs of other jobs that are active while one of these runs are needed.
    const runs: (PlannedRun & { name?: string })[] = [];
    const seen = new Set<string>();
    for (const start of starts) {
        for (const durationMs of durations) runs.push({ start, durationMs });
        for (const { job, cron } of others) {
            let from = new Date(start - job.estimatedMs);
            for (let index = 0; index < MAX_NEARBY; index++) {
                const next = cron.nextRun(from);
                if (!next || next.getTime() >= start + longest) break;
                const key = `${job.id}:${next.getTime()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    runs.push({ start: next.getTime(), durationMs: job.estimatedMs, name: job.name });
                }
                from = next;
            }
        }
    }

    const windows = findConflicts(runs, load.slots);
    const hits = starts.map((start) => windows.find((window) => window.from < start + longest && window.to > start) ?? null);
    const index = hits.findIndex((hit) => hit !== null);
    if (index === -1) return null;

    const start = starts[index];
    const window = hits[index]!;
    const from = Math.max(window.from, start);
    const to = Math.min(window.to, start + longest);
    const names = runs.filter((run) => run.name && run.start < to && run.start + Math.max(run.durationMs, 1) > from).map((run) => run.name!);
    return { at: new Date(start), everyRun: hits.every((hit) => hit !== null), others: [...new Set(names)], overlapMs: Math.max(to - from, 0) };
}
