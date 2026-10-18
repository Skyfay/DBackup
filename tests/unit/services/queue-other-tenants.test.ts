/**
 * The queue is one for every tenant, so a tenant's plan of it counts the runs of the others: its
 * runs wait behind them, the clash note of the schedule picker names them and the Overview marks
 * the overlap. A tenant never learns the name or the id of a job of another tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";

const MIN = 60_000;
const recent: Record<string, { id: string; status: string; startedAt: string; endedAt: string | null }[]> = {};
vi.mock("@/services/dashboard/aggregates", () => ({
    getRecentRunsByJob: () => Promise.resolve(recent),
    getSchedulerTimezone: () => Promise.resolve("UTC"),
    getMaxConcurrentJobs: () => Promise.resolve(1),
}));

const { getJobTimeline } = await import("@/services/jobs/job-timeline-service");
const { getScheduleLoad } = await import("@/services/jobs/schedule-load-service");
const { anonymousWaits, demandBeside } = await import("@/services/jobs/other-tenant-queue");
const { OTHER_TENANT_JOB, OTHER_TENANT_JOB_NAME } = await import("@/services/jobs/job-timeline-types");

const now = new Date("2026-10-02T02:50:00Z");
const run = (id: string, start: string, minutes: number) => ({
    id, status: "Success", startedAt: `2026-10-01T${start}:00.000Z`, endedAt: new Date(Date.parse(`2026-10-01T${start}:00Z`) + minutes * MIN).toISOString(),
});

type Where = { tenantId?: { not?: string } } | undefined;
const forOthers = (args: unknown) => Boolean((args as { where?: Where } | undefined)?.where?.tenantId?.not);

describe("a tenant's plan of the queue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(recent)) delete recent[key];
        // Acme backs up its ERP for 40 minutes at 03:00, Beta its shop for 10 minutes at 03:00.
        recent["acme-erp"] = [run("a1", "03:00", 40)];
        recent["beta-shop"] = [run("b1", "03:00", 10)];
        prismaMock.job.findMany.mockImplementation((async (args: unknown) => forOthers(args)
            ? [{ id: "acme-erp", schedule: "0 3 * * *", schedulePreset: null }]
            : [{ id: "beta-shop", name: "Shop", enabled: true, schedule: "0 3 * * *", schedulePresetId: null, schedulePreset: null }]) as never);
        prismaMock.execution.findMany.mockImplementation((async (args: unknown) => forOthers(args)
            // Acme's run of 02:30 still holds the only slot.
            ? [{ id: "acme-run", jobId: "acme-erp", status: "Running", startedAt: new Date("2026-10-02T02:30:00Z") }]
            : []) as never);
    });

    it("lets a planned run of the tenant wait behind a job of another tenant, named only as such", async () => {
        const timeline = await runAsTenant("beta", () => getJobTimeline(now));

        const atThree = timeline.planned.find((entry) => entry.jobId === "beta-shop" && entry.due === "2026-10-03T03:00:00.000Z");
        // Acme's run of the same time is due first by its key and takes the slot for 40 minutes.
        expect(atThree?.start).toBe("2026-10-03T03:40:00.000Z");
        expect(atThree?.waitsFor).toEqual([OTHER_TENANT_JOB]);
        expect(timeline.planned.every((entry) => entry.jobId === "beta-shop")).toBe(true);
        expect(timeline.otherTenants?.length).toBeGreaterThan(0);
        // Nothing of Acme reaches Beta but that a job of another tenant is there.
        expect(JSON.stringify(timeline)).not.toMatch(/acme/);
    });

    it("plans the queue with the runs of every tenant only where the request reads one tenant", async () => {
        const timeline = await getJobTimeline(now);

        expect(timeline.otherTenants).toBeUndefined();
        expect(prismaMock.job.findMany).toHaveBeenCalledTimes(1);
        expect(timeline.planned.find((entry) => entry.due === "2026-10-03T03:00:00.000Z")?.waitsFor).toEqual([]);
    });

    it("hands the schedule picker the jobs of other tenants without their name, id or preset", async () => {
        const load = await runAsTenant("beta", () => getScheduleLoad());

        expect(load.jobs.map((job) => job.name)).toEqual(["Shop", OTHER_TENANT_JOB_NAME]);
        expect(load.jobs[1]).toMatchObject({ schedule: "0 3 * * *", presetId: null, estimatedMs: 40 * MIN });
        expect(JSON.stringify(load)).not.toMatch(/acme/);
    });
});

describe("the pieces of a tenant's plan", () => {
    it("names every job of another tenant once and last among the jobs a run waits for", () => {
        expect(anonymousWaits(["own", "acme-1", "acme-2"], new Set(["acme-1", "acme-2"]))).toEqual(["own", OTHER_TENANT_JOB]);
        expect(anonymousWaits(["acme-1", "own"], new Set(["acme-1"]))).toEqual(["own", OTHER_TENANT_JOB]);
        expect(anonymousWaits(["own"], new Set(["acme-1"]))).toEqual(["own"]);
    });

    it("counts the runs of other tenants only while a run of the tenant shares the queue with them", () => {
        const others = [{ from: 0, to: 100 }, { from: 50, to: 80 }, { from: 200, to: 300 }];
        const own = [{ from: 40, to: 90 }];

        expect(demandBeside(others, own)).toEqual([
            { from: 40, to: 50, count: 1 },
            { from: 50, to: 80, count: 2 },
            { from: 80, to: 90, count: 1 },
        ]);
    });
});
