import type { Cron } from "croner";
import { readCronAtOffset } from "@/lib/core/cron";
import { runsBetween, steadyOffset, zoneReader, type ScheduleReader } from "@/lib/core/cron-window";
import { queueJobs } from "./queue-snapshot";

/**
 * When the schedules of the jobs of every tenant start runs over the next days, worked out once and
 * kept for the requests of the next minutes. The queue is one for every tenant, so the Overview and
 * the Timeline of each tenant play the runs of all the others through, and reading 25,000 schedules
 * took them a second or ten on every request.
 *
 * The plan holds each schedule once, however many jobs follow it, with every run it starts in the
 * window. A request cuts its own window from it. A schedule the plan does not hold yet, like the
 * one of a job saved since, is read when a request first asks for it. A plan at a fixed offset moves
 * its window on by reading only the runs past its end, a plan in a zone that changes its offset in
 * the window is made anew.
 */

/**
 * How the schedules are read: at a fixed offset from UTC in minutes, like the Timeline does, or as
 * the scheduler does in its time zone, see `zoneReader`.
 */
export type CronMode = { offset: number } | { timezone: string };

/** The runs of a schedule in a window, the first ones up to a limit and whether it has more there. */
export interface DueTimes {
    times: number[];
    truncated: boolean;
}

export interface QueuePlan {
    /**
     * The runs of the job's schedule after `now` up to the end of the window, at most `limit`, from
     * the plan when it can hold the schedule, else read with `read`, which reads the same window.
     * Null when `read` cannot read the expression, which never runs.
     */
    due(job: { schedule: string }, limit: number, read: ScheduleReader): DueTimes | null;
}

/** A plan serves the requests of this long after it was made, its window reaches as far beyond. */
const PLAN_REUSE_MS = 10 * 60 * 1000;
/** A plan starts this long before it was made, for the requests that started a moment before. */
const PLAN_BACK_MS = 60 * 1000;
/** A plan is made anew after this, which leaves out the schedules nobody follows any more. */
const PLAN_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * The runs a plan keeps of one schedule: every five minutes for a week and the reuse on top. A
 * schedule that runs more often is read again for each request, which only its jobs pay for.
 */
const PLAN_CAP = 7 * 24 * 12 + 2 * ((PLAN_REUSE_MS + PLAN_BACK_MS) / (5 * 60 * 1000)) + 10;

interface PlannedSchedule {
    /** The cron at the offset of the plan, to read the runs past its end. Null in a zone. */
    cron: Cron | null;
    /** Every run after the start of the plan up to its end, null for what the scheduler cannot read. */
    times: number[] | null;
    /** It has more runs in the window than the plan keeps. */
    cut: boolean;
}

interface Plan {
    mode: CronMode;
    madeAt: number;
    usedAt: number;
    /** The runs after this, a minute before the plan was made or moved on. */
    from: number;
    until: number;
    /** How a plan in a zone reads a schedule over its window. */
    inZone: ScheduleReader | null;
    schedules: Map<string, PlannedSchedule>;
}

// On globalThis, so the pages of every module graph share one.
const globalForPlans = globalThis as unknown as { __dbackupQueuePlans?: Map<string, Plan> };
const plans = (globalForPlans.__dbackupQueuePlans ??= new Map<string, Plan>());

const modeKey = (mode: CronMode) => ("offset" in mode ? `offset:${mode.offset}` : `zone:${mode.timezone}`);

/** Reads one schedule over the whole window of the plan, as the scheduler reads it. */
function planSchedule(plan: Plan, schedule: string): PlannedSchedule {
    const cron = "offset" in plan.mode ? readCronAtOffset(schedule, plan.mode.offset) : null;
    const times = cron ? runsBetween(cron, plan.from, plan.until, PLAN_CAP + 1) : plan.inZone?.(schedule, PLAN_CAP + 1) ?? null;
    if (!times) return { cron: null, times: null, cut: false };
    return times.length > PLAN_CAP ? { cron, times: times.slice(0, PLAN_CAP), cut: true } : { cron, times, cut: false };
}

function makePlan(mode: CronMode, schedules: Iterable<string>, now: number, until: number): Plan {
    const from = now - PLAN_BACK_MS;
    const inZone = "timezone" in mode ? zoneReader(mode.timezone, from, until) : null;
    const plan: Plan = { mode, madeAt: now, usedAt: now, from, until, inZone, schedules: new Map() };
    for (const schedule of schedules) {
        if (!plan.schedules.has(schedule)) plan.schedules.set(schedule, planSchedule(plan, schedule));
    }
    return plan;
}

/** The first index of a sorted list whose value is above `time`. */
function firstAfter(times: readonly number[], time: number): number {
    let low = 0;
    let high = times.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (times[middle] <= time) low = middle + 1;
        else high = middle;
    }
    return low;
}

/**
 * Moves a plan at a fixed offset on to a later window: drops the runs before it and reads only the
 * runs past its old end, of the schedules the jobs follow now.
 */
function moveOn(plan: Plan, schedules: Set<string>, now: number, until: number): void {
    const from = now - PLAN_BACK_MS;
    for (const [schedule, entry] of plan.schedules) {
        if (!schedules.has(schedule) || entry.cut) {
            plan.schedules.delete(schedule);
            continue;
        }
        if (!entry.cron || !entry.times) continue;
        const kept = entry.times.slice(firstAfter(entry.times, from));
        const added = runsBetween(entry.cron, plan.until, until, PLAN_CAP + 1 - kept.length);
        const times = kept.concat(added);
        entry.cut = times.length > PLAN_CAP;
        entry.times = entry.cut ? times.slice(0, PLAN_CAP) : times;
    }
    plan.from = from;
    plan.until = until;
}

function limited(times: number[], limit: number): DueTimes {
    return times.length > limit ? { times: times.slice(0, limit), truncated: true } : { times, truncated: false };
}

/**
 * When the schedules start runs after `now` until `until`, read in `mode`, from the plan that every
 * request of every tenant shares. The schedules of every job of the queue are planned at once.
 */
export async function queuePlan(mode: CronMode, now: number, until: number): Promise<QueuePlan> {
    const jobs = await queueJobs();
    const schedules = new Set(jobs.map((job) => job.schedule));
    // A zone that keeps its offset over the window reads like that offset, so the plan at it serves
    // the Overview and the Timeline alike.
    const steady = "timezone" in mode ? steadyOffset(mode.timezone, now - PLAN_BACK_MS, until + PLAN_REUSE_MS) : null;
    const resolved: CronMode = steady === null ? mode : { offset: steady };
    const key = modeKey(resolved);

    // A plan of another zone or offset is left behind when the setting or the season changes.
    for (const [other, stale] of plans) if (Date.now() - stale.usedAt > PLAN_MAX_AGE_MS) plans.delete(other);
    let plan = plans.get(key);
    if (!plan || now < plan.from || until > plan.until) {
        const movable = plan && "offset" in plan.mode && now >= plan.from && now - plan.madeAt <= PLAN_MAX_AGE_MS;
        if (plan && movable) moveOn(plan, schedules, now, until + PLAN_REUSE_MS);
        else plan = makePlan(resolved, schedules, now, until + PLAN_REUSE_MS);
        plans.set(key, plan);
    }
    plan.usedAt = Date.now();
    const current = plan;
    return {
        due(job, limit, read) {
            const schedule = job.schedule.trim();
            let planned = current.schedules.get(schedule);
            if (!planned) {
                planned = planSchedule(current, schedule);
                current.schedules.set(schedule, planned);
            }
            if (planned.times && !planned.cut) {
                const from = firstAfter(planned.times, now);
                const to = firstAfter(planned.times, until);
                // One more than the limit tells whether the job has more runs in the window.
                return limited(planned.times.slice(from, Math.min(to, from + limit + 1)), limit);
            }
            const times = read(job.schedule, limit + 1);
            return times ? limited(times, limit) : null;
        },
    };
}
