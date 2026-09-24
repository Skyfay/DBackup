import { Cron } from "croner";

/**
 * A cron expression as the scheduler reads it, in its time zone, or null when it cannot be read.
 * Five fields, or six with seconds in front. The instance only answers when it runs, it never
 * schedules anything.
 */
export function readCron(expression: string, timezone = "UTC"): Cron | null {
    return build(expression, { timezone });
}

/**
 * The same, read at a fixed offset from UTC in minutes. About fifty times faster than a named
 * time zone, for working out many runs at once.
 */
export function readCronAtOffset(expression: string, offsetMinutes: number): Cron | null {
    return build(expression, { utcOffset: offsetMinutes });
}

function build(expression: string, options: { timezone?: string; utcOffset?: number }): Cron | null {
    const trimmed = expression.trim();
    const fields = trimmed.split(/\s+/).length;
    if (fields !== 5 && fields !== 6) return null;
    try {
        return new Cron(trimmed, options);
    } catch {
        return null;
    }
}

export function isValidCron(expression: string): boolean {
    return readCron(expression) !== null;
}

/** The next start times of an expression, soonest first. None for one that cannot be read. */
export function nextRunTimes(expression: string, timezone: string, count: number, from = new Date()): Date[] {
    return readCron(expression, timezone)?.nextRuns(count, from) ?? [];
}
