import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const MIN = 60_000;
const recent: Record<string, { id: string; status: string; startedAt: string; endedAt: string | null }[]> = {};
vi.mock("@/services/dashboard/aggregates", () => ({
    getRecentRunsByJob: () => Promise.resolve(recent),
    getSchedulerTimezone: () => Promise.resolve("UTC"),
    getMaxConcurrentJobs: () => Promise.resolve(1),
}));

const { getJobTimeline } = await import("@/services/jobs/job-timeline-service");

const now = new Date("2026-10-02T03:12:00Z");
const run = (id: string, status: string, start: string, minutes: number) => ({
    id, status, startedAt: `2026-10-01T${start}:00.000Z`, endedAt: new Date(Date.parse(`2026-10-01T${start}:00Z`) + minutes * MIN).toISOString(),
});

describe("the runs of the Jobs timeline", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        recent.postgres = [run("p1", "Success", "03:00", 24)];
        recent.cache = [run("c1", "Success", "02:00", 0.05)];
        recent.mysql = [run("m1", "Failed", "02:00", 1)];
        prismaMock.job.findMany.mockResolvedValue([
            { id: "postgres", enabled: true, schedule: "0 3 * * *", schedulePreset: null },
            { id: "cache", enabled: true, schedule: "0 * * * *", schedulePreset: null },
            { id: "mysql", enabled: true, schedule: "0 2 * * *", schedulePreset: null },
            { id: "erp", enabled: false, schedule: "0 22 * * *", schedulePreset: null },
        ] as never);
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "live", jobId: "postgres", status: "Running", startedAt: new Date("2026-10-02T03:00:00Z"), endedAt: null, metadata: '{"stage":"Dumping","progress":64}' },
            { id: "queued", jobId: "cache", status: "Pending", startedAt: new Date("2026-10-02T03:00:00Z"), endedAt: null, metadata: null },
        ] as never);
    });

    it("plans each run with the usual length of its job and lets the one queued now wait for the running one", async () => {
        const timeline = await getJobTimeline(now);

        expect(timeline.estimates.postgres).toBe(24 * MIN);
        const queued = timeline.runs.find((entry) => entry.id === "queued");
        expect(queued).toMatchObject({ expectedStart: "2026-10-02T03:24:00.000Z", waitsFor: ["postgres"] });
        expect(timeline.runs.find((entry) => entry.id === "live")).toMatchObject({ stage: "Dumping", progress: 64 });
    });

    it("lets one of two planned runs that start together wait for the other, with the only slot", async () => {
        const timeline = await getJobTimeline(now);

        const atTwo = timeline.planned.filter((entry) => entry.due === "2026-10-03T02:00:00.000Z");
        const waiting = atTwo.filter((entry) => entry.start !== entry.due);
        expect(atTwo.map((entry) => entry.jobId).sort()).toEqual(["cache", "mysql"]);
        expect(waiting).toHaveLength(1);
        expect(waiting[0].waitsFor).toEqual(atTwo.filter((entry) => entry !== waiting[0]).map((entry) => entry.jobId));
    });

    it("plans nothing for a paused job and marks a job whose last run failed", async () => {
        const timeline = await getJobTimeline(now);

        expect(timeline.planned.some((entry) => entry.jobId === "erp")).toBe(false);
        expect(timeline.failing).toEqual(["mysql"]);
        expect(timeline.planned.filter((entry) => entry.jobId === "postgres").map((entry) => entry.due).slice(0, 2))
            .toEqual(["2026-10-03T03:00:00.000Z", "2026-10-04T03:00:00.000Z"]);
    });
});
