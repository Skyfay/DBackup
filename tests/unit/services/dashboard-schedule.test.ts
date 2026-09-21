import { describe, it, expect } from "vitest";
import { buildUpcomingSchedule, estimateDuration, findConflicts } from "@/services/dashboard/schedule";
import type { RunSummary } from "@/services/dashboard/types";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const MINUTE = 60_000;

function run(status: string, startedAt: string, minutes: number | null): RunSummary {
    const endedAt = minutes === null ? null : new Date(Date.parse(startedAt) + minutes * MINUTE).toISOString();
    return { id: `${status}-${startedAt}`, status, startedAt, endedAt };
}

describe("findConflicts", () => {
    it("flags the stretch where two runs share a single slot", () => {
        const conflicts = findConflicts([
            { start: 0, durationMs: 10 * MINUTE },
            { start: 5 * MINUTE, durationMs: 10 * MINUTE },
        ], 1);

        expect(conflicts).toEqual([{ from: 5 * MINUTE, to: 10 * MINUTE, demand: 2 }]);
    });

    it("does not count back-to-back runs as overlapping", () => {
        expect(findConflicts([
            { start: 0, durationMs: 10 * MINUTE },
            { start: 10 * MINUTE, durationMs: 10 * MINUTE },
        ], 1)).toEqual([]);
    });

    it("reports the peak demand of a window, like four jobs wanting three slots", () => {
        const midnight = Array.from({ length: 4 }, () => ({ start: 0, durationMs: 30 * MINUTE }));

        expect(findConflicts(midnight, 3)).toEqual([{ from: 0, to: 30 * MINUTE, demand: 4 }]);
    });

    it("finds nothing when the queue has enough slots", () => {
        const midnight = Array.from({ length: 3 }, () => ({ start: 0, durationMs: 30 * MINUTE }));

        expect(findConflicts(midnight, 3)).toEqual([]);
    });
});

describe("estimateDuration", () => {
    it("averages the finished runs and ignores cancelled and running ones", () => {
        const runs = [
            run("Success", "2026-09-20T02:00:00.000Z", 4),
            run("Failed", "2026-09-19T02:00:00.000Z", 2),
            run("Cancelled", "2026-09-18T02:00:00.000Z", 50),
            run("Running", "2026-09-21T02:00:00.000Z", null),
        ];

        expect(estimateDuration(runs)).toBe(3 * MINUTE);
    });

    it("assumes a minute for a job that never finished a run", () => {
        expect(estimateDuration([])).toBe(MINUTE);
    });
});

describe("buildUpcomingSchedule", () => {
    it("lists the runs of the next 48 hours, the longest range the card offers", () => {
        const schedule = buildUpcomingSchedule(
            [{ id: "hourly", name: "hourly", schedule: "0 * * * *" }],
            new Map(),
            new Set(),
            1,
            "UTC",
            NOW,
        );

        expect(schedule.runs).toHaveLength(48);
        expect(schedule.runs[0].at).toBe("2026-09-21T11:00:00.000Z");
        expect(schedule.runs[47].at).toBe("2026-09-23T10:00:00.000Z");
        expect(schedule.windowEnd).toBe("2026-09-23T10:00:00.000Z");
        // The job's name is sent once, not with every run.
        expect(schedule.jobs).toEqual([{ id: "hourly", name: "hourly", estimatedMs: MINUTE, likelyToFail: false }]);
    });

    it("predicts a queue when two jobs start together with one slot, using their usual duration", () => {
        const history = new Map([
            ["a", [run("Success", "2026-09-20T12:00:00.000Z", 10)]],
            ["b", [run("Success", "2026-09-20T12:00:00.000Z", 6)]],
        ]);

        const schedule = buildUpcomingSchedule(
            [
                { id: "a", name: "postgres-nightly", schedule: "0 12 * * *" },
                { id: "b", name: "mysql-nightly", schedule: "0 12 * * *" },
            ],
            history,
            new Set(),
            1,
            "UTC",
            NOW,
        );

        // Once today and once tomorrow.
        expect(schedule.conflicts).toEqual([
            { from: "2026-09-21T12:00:00.000Z", to: "2026-09-21T12:06:00.000Z", demand: 2 },
            { from: "2026-09-22T12:00:00.000Z", to: "2026-09-22T12:06:00.000Z", demand: 2 },
        ]);
    });

    it("marks the runs of a job whose last run failed", () => {
        const schedule = buildUpcomingSchedule(
            [
                { id: "broken", name: "analytics", schedule: "30 12 * * *" },
                { id: "fine", name: "files", schedule: "0 13 * * *" },
            ],
            new Map(),
            new Set(["broken"]),
            1,
            "UTC",
            NOW,
        );

        expect(schedule.jobs.map((entry) => [entry.name, entry.likelyToFail])).toEqual([
            ["analytics", true],
            ["files", false],
        ]);
        expect(schedule.runs.map((entry) => entry.jobId)).toEqual(["broken", "fine", "broken", "fine"]);
    });

    it("caps a job that runs every minute and says so", () => {
        const schedule = buildUpcomingSchedule(
            [{ id: "busy", name: "busy", schedule: "* * * * *" }],
            new Map(),
            new Set(),
            1,
            "UTC",
            NOW,
        );

        expect(schedule.runs).toHaveLength(576);
        expect(schedule.truncated).toBe(true);
    });

    it("skips a job with an invalid schedule", () => {
        const schedule = buildUpcomingSchedule(
            [{ id: "bad", name: "bad", schedule: "not a cron" }],
            new Map(),
            new Set(),
            1,
            "UTC",
            NOW,
        );

        expect(schedule.runs).toEqual([]);
    });
});
