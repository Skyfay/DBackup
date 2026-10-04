import { getTimezoneOffset } from "date-fns-tz";
import { readCronAtOffset } from "./cron";

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
    /** The first start that has to wait for a slot. */
    at: Date;
    /** Every start checked has to wait, like a daily time that meets another daily job. */
    everyRun: boolean;
    /** The other jobs ahead in the queue then. Empty when only the jobs of one preset wait for each other. */
    others: string[];
    /** How long the run waits for a slot, the longest wait when several jobs start on the schedule. */
    waitMs: number;
}

/** Assumed length of a run for a job without any finished run to learn from. */
export const DEFAULT_RUN_MS = 60_000;
const HORIZON_MS = 8 * 24 * 60 * 60 * 1000;
const MIN_STARTS = 3;
const MAX_STARTS = 200;
/** Enough for a job that runs every minute over the whole horizon. */
const MAX_RUNS_PER_JOB = 12_000;
/** Runs of one other job looked at around a start past the horizon. */
const MAX_NEARBY = 20;

interface OtherRun {
    start: number;
    end: number;
    name: string;
}

/**
 * The runs of the other jobs over the next days, worked out once, so trying one schedule after
 * another only looks them up. Past the horizon, like the later runs of a monthly schedule, the
 * other jobs are asked one by one.
 *
 * Every schedule is read at the offset the scheduler's time zone has now, which is far faster
 * than the zone itself. All jobs share that zone, so a change to summer time moves all of them
 * alike and the overlaps stay right.
 */
export interface ClashContext {
    offset: number;
    /** The offset as a zone the times of a clash are shown in, like +02:00. */
    zone: string;
    slots: number;
    now: number;
    /** One estimated duration per job that starts on the schedule being picked. */
    own: number[];
    /** Soonest first. */
    runs: OtherRun[];
    /** Every run of the other jobs that starts before this instant is in runs. */
    until: number;
    longestOther: number;
    others: { name: string; estimatedMs: number; cron: NonNullable<ReturnType<typeof readCronAtOffset>> }[];
}

function zoneOf(offset: number): string {
    const sign = offset < 0 ? "-" : "+";
    const minutes = Math.abs(offset);
    return `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function clashContext(load: ScheduleLoad, owners: ScheduleOwners, now = new Date()): ClashContext {
    const measured = Math.round(getTimezoneOffset(load.timezone, now) / 60_000);
    const offset = Number.isFinite(measured) ? measured : 0;
    const others = load.jobs.flatMap((job) => {
        if (owners.ids.includes(job.id)) return [];
        const cron = readCronAtOffset(job.schedule, offset);
        return cron ? [{ name: job.name, estimatedMs: Math.max(job.estimatedMs, 1), cron }] : [];
    });
    const longestOther = Math.max(0, ...others.map((other) => other.estimatedMs));
    let until = now.getTime() + HORIZON_MS;
    const runs: OtherRun[] = [];
    for (const other of others) {
        let cursor = new Date(now.getTime() - longestOther);
        for (let index = 0; ; index++) {
            const next = other.cron.nextRun(cursor);
            if (!next || next.getTime() >= until) break;
            if (index === MAX_RUNS_PER_JOB) {
                // A job that runs even more often cuts the horizon short where its list ends.
                until = next.getTime();
                break;
            }
            runs.push({ start: next.getTime(), end: next.getTime() + other.estimatedMs, name: other.name });
            cursor = next;
        }
    }
    runs.sort((a, b) => a.start - b.start);
    return {
        offset,
        zone: zoneOf(offset),
        slots: Math.max(load.slots, 1),
        now: now.getTime(),
        own: owners.durations.length > 0 ? owners.durations : [DEFAULT_RUN_MS],
        runs: runs.filter((run) => run.start < until),
        until,
        longestOther,
        others,
    };
}

/** The starts of a schedule to check: the next eight days, and at least the next three. */
export function scheduleStarts(expression: string, context: ClashContext): number[] | null {
    const cron = readCronAtOffset(expression, context.offset);
    const now = context.now;
    if (!cron) return null;
    const end = now + HORIZON_MS;
    const starts: number[] = [];
    let from = new Date(now);
    while (starts.length < MAX_STARTS) {
        const next = cron.nextRun(from);
        if (!next || (next.getTime() > end && starts.length >= MIN_STARTS)) break;
        starts.push(next.getTime());
        from = next;
    }
    return starts;
}

/** The runs of other jobs that are due or still running at an instant. */
function activeAt(context: ClashContext, time: number): OtherRun[] {
    if (time < context.until) {
        let low = 0;
        let high = context.runs.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (context.runs[middle].start <= time) low = middle + 1;
            else high = middle;
        }
        const active: OtherRun[] = [];
        for (let index = low - 1; index >= 0 && context.runs[index].start > time - context.longestOther; index--) {
            if (context.runs[index].end > time) active.push(context.runs[index]);
        }
        // Soonest first, the order the queue took them in.
        return active.reverse();
    }
    return context.others.flatMap((other) => {
        const found: OtherRun[] = [];
        let cursor = new Date(time - other.estimatedMs);
        for (let index = 0; index < MAX_NEARBY; index++) {
            const next = other.cron.nextRun(cursor);
            if (!next || next.getTime() > time) break;
            found.push({ start: next.getTime(), end: next.getTime() + other.estimatedMs, name: other.name });
            cursor = next;
        }
        return found;
    });
}

/**
 * How long each job on the schedule waits at an instant. The queue takes runs in order, so the
 * runs already due or running go first and take the slots, and these jobs start once one frees up.
 */
function waitsAt(time: number, ahead: OtherRun[], own: number[], slots: number): number[] {
    const free = Array.from({ length: slots }, () => Number.NEGATIVE_INFINITY);
    const take = (from: number, length: number) => {
        let index = 0;
        for (let slot = 1; slot < free.length; slot++) if (free[slot] < free[index]) index = slot;
        const begin = Math.max(free[index], from);
        free[index] = begin + length;
        return begin;
    };
    for (const run of [...ahead].sort((a, b) => a.start - b.start)) take(run.start, run.end - run.start);
    return own.map((length) => take(time, length) - time);
}

/**
 * Whether runs on this schedule would wait for a free slot of the queue, and for how long.
 * Nothing is reported while the slots are enough, however many jobs start at the same time.
 */
export function findScheduleClash(expression: string, context: ClashContext): ScheduleClash | null {
    const starts = scheduleStarts(expression, context);
    return starts ? clashAtStarts(starts, context) : null;
}

/**
 * The same for starts already worked out. A schedule moved by some minutes starts that much
 * later every time, so a suggestion only moves the starts instead of reading cron again.
 */
export function clashAtStarts(starts: number[], context: ClashContext): ScheduleClash | null {
    if (starts.length === 0) return null;

    let first: ScheduleClash | null = null;
    let everyRun = true;
    for (const start of starts) {
        const ahead = activeAt(context, start);
        const wait = Math.max(...waitsAt(start, ahead, context.own, context.slots));
        if (wait <= 0) {
            everyRun = false;
            continue;
        }
        first ??= { at: new Date(start), everyRun: true, others: [...new Set(ahead.map((run) => run.name))], waitMs: wait };
    }
    return first && { ...first, everyRun };
}
