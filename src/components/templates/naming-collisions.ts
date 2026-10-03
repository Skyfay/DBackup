import { nextRunTimes } from "@/lib/core/cron";
import { applyNamingPattern } from "@/lib/templates/naming-template-engine";

/** The pattern a job without a template of its own and without a default one is named by. */
export const BUILT_IN_PATTERN = "{job_name}_yyyy-MM-dd_HH-mm-ss";

/** How far ahead a schedule is checked: about a month, or this many runs of a job that runs often. */
const HORIZON_MS = 32 * 24 * 60 * 60 * 1000;
const MAX_RUNS = 240;

/** Two runs that get the same file name, the later one replacing the earlier backup. */
export interface NameClash {
    first: Date;
    second: Date;
}

/** Whether the pattern writes the hour into the name, which two backups on one day need to differ. */
export function hasTimeOfDay(pattern: string): boolean {
    return pattern.includes("HH");
}

/** Whether the pattern writes any date or time at all, without which every backup gets the same name. */
export function hasDateOrTime(pattern: string): boolean {
    return /yyyy|MM|dd|HH|mm|ss/.test(pattern);
}

/** Whether every unit from the year down to the second is in the name, so no two runs of a schedule share one. */
function namesEverySecond(pattern: string): boolean {
    return ["yyyy", "MM", "dd", "HH", "mm", "ss"].every((token) => pattern.includes(token));
}

/**
 * The first two runs of a schedule that get the same file name, the way the runner names them in
 * the time zone of the scheduler, or null. The job and database names are the same for every run,
 * so only the date and time in the pattern decide. A pattern with every unit down to the second
 * never repeats, since a schedule starts at most once a minute.
 */
export function firstNameClash(pattern: string, schedule: string, timezone: string, from = new Date()): NameClash | null {
    if (namesEverySecond(pattern)) return null;
    const until = from.getTime() + HORIZON_MS;
    const seen = new Map<string, Date>();
    for (const run of nextRunTimes(schedule, timezone, MAX_RUNS, from)) {
        if (run.getTime() > until) break;
        const name = applyNamingPattern(pattern, "job", "db", run, timezone);
        const earlier = seen.get(name);
        if (earlier) return { first: earlier, second: run };
        seen.set(name, run);
    }
    return null;
}
