import type { HealthCheck } from "@/services/adapters/health-history";

export type HealthTone = "success" | "warning" | "destructive";

/** A change in the checks worth a line of its own, like a connection going offline. */
export interface HealthEvent {
    at: string;
    tone: HealthTone;
    text: string;
}

const MINUTE_MS = 60_000;

/** A length of time for a sentence: "less than a minute", "20 min", "3 h 12 min", "2 days 4 h". */
export function durationText(ms: number): string {
    const minutes = Math.floor(ms / MINUTE_MS);
    if (minutes < 1) return "less than a minute";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 > 0 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    const dayText = `${days} day${days === 1 ? "" : "s"}`;
    return hours % 24 > 0 ? `${dayText} ${hours % 24} h` : dayText;
}

/** How many checks in a row failed, counted from the newest. Takes the checks newest first. */
export function failedInRow(checks: HealthCheck[]): number {
    const index = checks.findIndex((check) => check.status === "ONLINE");
    return index === -1 ? checks.length : index;
}

const passed = (check: HealthCheck) => check.status === "ONLINE";

/**
 * The changes within the given checks, newest first and at most `max`. Takes the checks
 * newest first, as the history API returns them.
 *
 * A failure that is still going on gets its failed checks while the connection is degraded,
 * or the moment it went offline, its first failed check and its last passed check. A failure
 * that is over gets one line at its start that says how it ended.
 */
export function healthEvents(newestFirst: HealthCheck[], max = 3): HealthEvent[] {
    const checks = [...newestFirst].reverse();
    const events: HealthEvent[] = [];

    let start = 0;
    while (start < checks.length) {
        if (passed(checks[start])) {
            start++;
            continue;
        }
        let end = start;
        while (end + 1 < checks.length && !passed(checks[end + 1])) end++;

        const run = checks.slice(start, end + 1);
        const offlineAt = run.findIndex((check) => check.status === "OFFLINE");
        const before = checks[start - 1];
        const after = checks[end + 1];

        if (after && !before) {
            // A failure that began before the listed checks, so only its end is known.
            events.push({ at: after.createdAt, tone: "success", text: offlineAt === -1 ? "Answered again" : "Back online" });
        } else if (after) {
            // A failure that is over.
            const failed = run.length;
            let text = failed === 1 ? "One check failed, the next one passed" : `${failed} checks failed, then it answered again`;
            if (offlineAt !== -1) {
                text = `Offline for ${durationText(Date.parse(after.createdAt) - Date.parse(run[offlineAt].createdAt))}, then back`;
            }
            events.push({ at: run[0].createdAt, tone: offlineAt === -1 ? "warning" : "destructive", text });
        } else if (offlineAt === -1) {
            // Still failing, but not offline yet: every failed check with its reason.
            for (const check of run) events.push({ at: check.createdAt, tone: "warning", text: check.error || "The check failed" });
        } else {
            // Offline. How many failed checks it took is only known when the first one is listed.
            if (before) {
                events.push({ at: before.createdAt, tone: "success", text: `Last passed check, ${before.latencyMs} ms` });
                events.push({ at: run[0].createdAt, tone: "warning", text: "First failed check" });
            }
            // Offline from the first listed check on means it went offline before them.
            if (before || offlineAt > 0) {
                events.push({
                    at: run[offlineAt].createdAt,
                    tone: "destructive",
                    text: before ? `Offline after ${offlineAt + 1} failed checks` : "Went offline",
                });
            }
        }
        start = end + 1;
    }

    return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}
