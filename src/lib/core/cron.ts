import { Cron } from "croner";

/**
 * A cron expression as the scheduler reads it, in its time zone, or null when it cannot be read.
 * Five fields, or six with seconds in front. The instance only answers when it runs, it never
 * schedules anything.
 */
export function readCron(expression: string, timezone = "UTC"): Cron | null {
    const trimmed = expression.trim();
    const fields = trimmed.split(/\s+/).length;
    if (fields !== 5 && fields !== 6) return null;
    try {
        return new Cron(trimmed, { timezone });
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
