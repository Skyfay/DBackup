import { describe, it, expect } from "vitest";
import { durationText, failedInRow, healthEvents } from "@/components/adapter/health-story";
import type { HealthCheck, HealthCheckStatus } from "@/services/adapters/health-history";

/** One check a minute ending at 13:58, given oldest first and returned newest first like the API. */
function checks(spec: [HealthCheckStatus, number?, string?][]): HealthCheck[] {
    const end = Date.parse("2026-09-22T13:58:00.000Z");
    return spec
        .map(([status, latencyMs = 30, error], index) => ({
            id: `c${index}`,
            status,
            latencyMs,
            error: error ?? null,
            createdAt: new Date(end - (spec.length - 1 - index) * 60_000).toISOString(),
        }))
        .reverse();
}

const repeat = (count: number, status: HealthCheckStatus, error?: string): [HealthCheckStatus, number?, string?][] =>
    Array.from({ length: count }, () => [status, 30, error]);

describe("durationText", () => {
    it("reads like a sentence at every scale", () => {
        expect(durationText(20_000)).toBe("less than a minute");
        expect(durationText(20 * 60_000)).toBe("20 min");
        expect(durationText((3 * 60 + 12) * 60_000)).toBe("3 h 12 min");
        expect(durationText(2 * 3_600_000)).toBe("2 h");
        expect(durationText(26 * 3_600_000)).toBe("1 day 2 h");
        expect(durationText(72 * 3_600_000)).toBe("3 days");
    });
});

describe("failedInRow", () => {
    it("counts the failed checks since the last one that passed", () => {
        expect(failedInRow(checks([...repeat(5, "ONLINE"), ...repeat(2, "DEGRADED")]))).toBe(2);
        expect(failedInRow(checks(repeat(3, "ONLINE")))).toBe(0);
    });
});

describe("healthEvents", () => {
    it("has nothing to tell when every check passed", () => {
        expect(healthEvents(checks(repeat(60, "ONLINE")))).toEqual([]);
    });

    it("lists the failed checks of a degraded connection with their reason, newest first", () => {
        const history = checks([...repeat(17, "ONLINE"), ["DEGRADED"], ...repeat(40, "ONLINE"), ...repeat(2, "DEGRADED", "Timeout after 5000 ms")]);

        expect(healthEvents(history)).toEqual([
            { at: "2026-09-22T13:58:00.000Z", tone: "warning", text: "Timeout after 5000 ms" },
            { at: "2026-09-22T13:57:00.000Z", tone: "warning", text: "Timeout after 5000 ms" },
            { at: "2026-09-22T13:16:00.000Z", tone: "warning", text: "One check failed, the next one passed" },
        ]);
    });

    it("tells when an offline connection last answered and when it went offline", () => {
        const history = checks([...repeat(37, "ONLINE"), ["ONLINE", 51], ...repeat(2, "DEGRADED"), ...repeat(20, "OFFLINE")]);

        expect(healthEvents(history)).toEqual([
            { at: "2026-09-22T13:39:00.000Z", tone: "destructive", text: "Offline after 3 failed checks" },
            { at: "2026-09-22T13:37:00.000Z", tone: "warning", text: "First failed check" },
            { at: "2026-09-22T13:36:00.000Z", tone: "success", text: "Last passed check, 51 ms" },
        ]);
    });

    it("sums up an outage that is over in one line", () => {
        const history = checks([...repeat(10, "ONLINE"), ...repeat(2, "DEGRADED"), ...repeat(12, "OFFLINE"), ...repeat(5, "ONLINE")]);

        expect(healthEvents(history)).toEqual([{ at: "2026-09-22T13:40:00.000Z", tone: "destructive", text: "Offline for 12 min, then back" }]);
    });

    it("does not invent a start for a failure older than the listed checks", () => {
        expect(healthEvents(checks([...repeat(4, "OFFLINE"), ...repeat(3, "ONLINE")]))).toEqual([
            { at: "2026-09-22T13:56:00.000Z", tone: "success", text: "Back online" },
        ]);
        expect(healthEvents(checks(repeat(10, "OFFLINE")))).toEqual([]);
    });
});
