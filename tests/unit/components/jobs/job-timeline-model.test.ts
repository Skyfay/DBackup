import { describe, expect, it } from "vitest";
import { agendaOf, barsOf, demandOf, HOUR_MS, packBars, rangeOf } from "@/components/dashboard/jobs/timeline/job-timeline-model";
import type { JobTimeline } from "@/services/jobs/job-timeline-types";

const MIN = 60_000;
const at = (time: string) => `2026-10-${time}:00.000Z`;
const dayStart = (time: number) => Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth(), new Date(time).getUTCDate());

function timeline(): JobTimeline {
    const hourly = Array.from({ length: 30 }, (_, index) => {
        const due = Date.parse(at("02T04:00")) + index * HOUR_MS;
        return { jobId: "cache", due: new Date(due).toISOString(), start: new Date(due).toISOString(), end: new Date(due + 3_000).toISOString(), waitsFor: [] };
    });
    return {
        now: at("02T03:12"), from: at("01T00:00"), to: at("09T00:00"), slots: 1,
        estimates: { postgres: 24 * MIN, cache: 3_000, mysql: MIN, files: 10 * MIN },
        failing: ["mysql"],
        runs: [
            { id: "f1", jobId: "files", status: "Partial", startedAt: at("02T00:00"), endedAt: at("02T00:11"), stage: null, progress: null, expectedStart: null, expectedEnd: null, waitsFor: [] },
            { id: "p1", jobId: "postgres", status: "Running", startedAt: at("02T03:00"), endedAt: null, stage: "Dumping", progress: 64, expectedStart: at("02T03:00"), expectedEnd: at("02T03:24"), waitsFor: [] },
            { id: "c1", jobId: "cache", status: "Pending", startedAt: at("02T03:00"), endedAt: null, stage: null, progress: null, expectedStart: at("02T03:24"), expectedEnd: at("02T03:24"), waitsFor: ["postgres"] },
        ],
        planned: [
            ...hourly,
            { jobId: "files", due: at("02T06:00"), start: at("02T06:00"), end: at("02T06:10"), waitsFor: [] },
            { jobId: "mysql", due: at("03T02:00"), start: at("03T02:00"), end: at("03T02:01"), waitsFor: [] },
            { jobId: "files", due: at("05T06:00"), start: at("05T06:00"), end: at("05T06:10"), waitsFor: [] },
        ],
        truncated: [],
    };
}

describe("the Jobs timeline", () => {
    it("shows the last 6 hours and the next 24 by default, and whole days from midnight when zoomed out", () => {
        const now = Date.parse(at("02T03:12"));

        expect(rangeOf("day", 0, now, dayStart)).toEqual({ from: now - 6 * HOUR_MS, to: now + 24 * HOUR_MS });
        expect(rangeOf("days", 1, now, dayStart)).toEqual({ from: Date.parse(at("05T00:00")), to: Date.parse(at("08T00:00")) });
    });

    it("draws what ran, what runs and what waits, then the plan, with a job whose last run failed marked", () => {
        const data = timeline();
        const range = rangeOf("day", 0, Date.parse(data.now), dayStart);

        expect(barsOf("files", data, range).map((bar) => bar.kind)).toEqual(["partial", "planned"]);
        expect(barsOf("postgres", data, range)[0]).toMatchObject({ kind: "running", end: Date.parse(at("02T03:24")) });
        expect(barsOf("cache", data, range)[0]).toMatchObject({ kind: "pending", waitFrom: Date.parse(at("02T03:00")), start: Date.parse(at("02T03:24")) });
        expect(barsOf("mysql", data, range)[0].kind).toBe("likely");
    });

    it("folds runs too close to tell apart, but never a different outcome among them", () => {
        const bars = barsOf("cache", timeline(), { from: Date.parse(at("02T00:00")), to: Date.parse(at("09T00:00")) });
        const groups = packBars(bars, 2 * HOUR_MS);

        expect(groups[0].bars.map((bar) => bar.kind)).toEqual(["pending"]);
        expect(groups[1].bars.length).toBe(30);
    });

    it("counts the runs that run or wait at once, so a moment with more than the slots shows", () => {
        const data = timeline();
        const range = rangeOf("day", 0, Date.parse(data.now), dayStart);
        const bars = ["postgres", "cache"].flatMap((jobId) => barsOf(jobId, data, range));
        const busy = demandOf(bars, range).find((segment) => segment.from === Date.parse(at("02T03:00")));

        expect(busy).toEqual({ from: Date.parse(at("02T03:00")), to: Date.parse(at("02T03:24")), count: 2 });
    });

    it("lists the next day by time, folds a job that runs every hour and names the jobs with nothing planned", () => {
        const agenda = agendaOf(timeline(), ["postgres", "cache", "files", "mysql", "weekly"], 24 * HOUR_MS, dayStart);

        expect(agenda.now.map((row) => row.kind)).toEqual(["running", "pending"]);
        expect(agenda.frequent).toEqual([{ jobId: "cache", runs: 24, waits: 0 }]);
        expect(agenda.days.flatMap((day) => day.rows.map((row) => `${row.jobId} ${row.kind}`))).toEqual(["files planned", "mysql likely"]);
        expect(agenda.earlier.map((run) => run.id)).toEqual(["f1"]);
        expect(agenda.quiet).toEqual(["weekly"]);
    });
});
