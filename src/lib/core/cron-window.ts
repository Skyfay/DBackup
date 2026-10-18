import { Cron } from "croner";

/**
 * When cron expressions start runs over one window of time, for planning the runs of many jobs at
 * once. A cron in a named time zone takes about a tenth of a millisecond for each run it finds,
 * which made 25,000 daily jobs over two days take ten seconds. Read at a fixed offset from UTC it is
 * about fifty times faster, and gives the same runs while the zone keeps that offset.
 */

/** The runs of an expression after the start of the window up to its end, at most `limit`, or null when it cannot be read. */
export type ScheduleReader = (expression: string, limit: number) => number[] | null;

/** How the scheduler reads expressions: five fields, or six with seconds in front. Anything croner reads otherwise. */
export type CronSyntax = "scheduler" | "croner";

type CronOptions = { timezone: string } | { utcOffset: number };

/** The furthest a change of a time zone moves its clock, with room to spare. */
const ZONE_SHIFT_MS = 3 * 60 * 60 * 1000;
/** No zone changes its offset twice within this, so samples this far apart see every change. */
const SAMPLE_MS = 30 * 60 * 1000;

function makeCron(expression: string, options: CronOptions, syntax: CronSyntax): Cron | null {
    const trimmed = expression.trim();
    if (syntax === "scheduler") {
        const fields = trimmed.split(/\s+/).length;
        if (fields !== 5 && fields !== 6) return null;
    }
    try {
        return new Cron(syntax === "scheduler" ? trimmed : expression, options);
    } catch {
        return null;
    }
}

/**
 * The runs of `cron` after `from` up to and including `until`, at most `limit` of them. Counting
 * stops at the end of the window, so an hourly job costs as many steps as it has runs there.
 */
export function runsBetween(cron: Cron, from: number, until: number, limit: number): number[] {
    const times: number[] = [];
    let previous: Date | null = new Date(from);
    while (times.length < limit) {
        previous = cron.nextRun(previous);
        if (!previous || previous.getTime() > until) break;
        times.push(previous.getTime());
    }
    return times;
}

/** A reader that reads nothing of an expression croner fails on, which never runs. */
function guarded(read: ScheduleReader): ScheduleReader {
    return (expression, limit) => {
        try {
            return read(expression, limit);
        } catch {
            return null;
        }
    };
}

/** Reads expressions at a fixed offset from UTC in minutes over the window. */
export function offsetReader(offset: number, from: number, until: number, syntax: CronSyntax = "scheduler"): ScheduleReader {
    return guarded((expression, limit) => {
        const cron = makeCron(expression, { utcOffset: offset }, syntax);
        return cron ? runsBetween(cron, from, until, limit) : null;
    });
}

interface OffsetChange {
    /** The first instant of the new offset. */
    at: number;
    /** The offsets before and after, in minutes. */
    before: number;
    after: number;
}

const formats = new Map<string, Intl.DateTimeFormat | null>();

function formatOf(timezone: string): Intl.DateTimeFormat | null {
    let format = formats.get(timezone);
    if (format === undefined) {
        try {
            format = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hourCycle: "h23",
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
            });
        } catch {
            format = null;
        }
        formats.set(timezone, format);
    }
    return format;
}

/**
 * The offset of the zone at an instant in minutes, NaN for a zone that does not exist. Read from the
 * wall clock the zone shows then, since `getTimezoneOffset` of date-fns-tz answers with the old
 * offset for a while after a change.
 */
function offsetAt(timezone: string, time: number): number {
    const format = formatOf(timezone);
    if (!format) return Number.NaN;
    const parts = format.formatToParts(new Date(time));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
    const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    return Math.round((wall - Math.floor(time / 1000) * 1000) / 60_000);
}

/** Every change of the zone's offset from `from` to `until`, null for a zone that does not exist. */
function offsetChanges(timezone: string, from: number, until: number): OffsetChange[] | null {
    let previous = offsetAt(timezone, from);
    if (!Number.isFinite(previous)) return null;
    const changes: OffsetChange[] = [];
    for (let time = from; time < until;) {
        const next = Math.min(time + SAMPLE_MS, until);
        const offset = offsetAt(timezone, next);
        if (offset !== previous) {
            // The first millisecond of the new offset, between the two samples.
            let low = time;
            let high = next;
            while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                if (offsetAt(timezone, middle) === previous) low = middle;
                else high = middle;
            }
            changes.push({ at: high, before: previous, after: offset });
            previous = offset;
        }
        time = next;
    }
    return changes;
}

/**
 * The offset from UTC in minutes the zone keeps over the window and a little around it, or null when
 * it changes there, like at the change to summer time, or the zone does not exist.
 */
export function steadyOffset(timezone: string, from: number, until: number): number | null {
    const changes = offsetChanges(timezone, from - ZONE_SHIFT_MS, until + ZONE_SHIFT_MS);
    if (changes === null || changes.length > 0) return null;
    return offsetAt(timezone, from);
}

/**
 * Reads expressions in a named time zone over the window, with the same runs as a cron of that zone.
 *
 * - While the zone keeps one offset over the window and a few hours around it, at that offset: a
 *   run the offset puts there is a local time the zone has once, at that same offset.
 * - Across one change of the offset, at the offset before it for the runs before the change and at
 *   the one after it for the rest. Only a local time inside the hour the change skips or repeats
 *   reads differently in the zone, so an expression that starts a run in that hour of the day of the
 *   change is read in the zone itself.
 * - Otherwise, and for a zone the offsets cannot be read of, in the zone itself.
 */
export function zoneReader(timezone: string, from: number, until: number, syntax: CronSyntax = "scheduler"): ScheduleReader {
    // A zone croner cannot read runs nothing.
    const inZone = guarded((expression, limit) => {
        const cron = makeCron(expression, { timezone }, syntax);
        return cron ? runsBetween(cron, from, until, limit) : null;
    });
    const changes = offsetChanges(timezone, from - ZONE_SHIFT_MS, until + ZONE_SHIFT_MS);
    if (changes === null || changes.length > 1) return inZone;
    if (changes.length === 0) return offsetReader(offsetAt(timezone, from), from, until, syntax);

    const [{ at, before, after }] = changes;
    // The local times the change skips or repeats, as instants of a clock at UTC.
    const skippedFrom = at + Math.min(before, after) * 60_000;
    const skippedTo = at + Math.max(before, after) * 60_000;
    return guarded((expression, limit) => {
        const local = makeCron(expression, { utcOffset: 0 }, syntax);
        if (!local) return null;
        if (runsBetween(local, skippedFrom - 1, skippedTo - 1, 1).length > 0) return inZone(expression, limit);

        const early = makeCron(expression, { utcOffset: before }, syntax);
        const late = makeCron(expression, { utcOffset: after }, syntax);
        if (!early || !late) return inZone(expression, limit);
        const times = at > from ? runsBetween(early, from, Math.min(until, at - 1), limit) : [];
        if (times.length < limit && at <= until) times.push(...runsBetween(late, Math.max(from, at - 1), until, limit - times.length));
        return times;
    });
}
