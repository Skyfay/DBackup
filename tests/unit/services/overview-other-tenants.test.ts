/**
 * The Upcoming card of the Overview: in a tenant the runs of the other tenants share the one queue,
 * so they count toward an overlap with a run of the tenant, without being listed. In All tenants
 * every job names its tenant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-21T10:00:00.000Z");
const finished = (id: string, minutes: number) => ({ id, status: "Success", startedAt: "2026-09-20T03:00:00.000Z", endedAt: new Date(Date.parse("2026-09-20T03:00:00.000Z") + minutes * 60_000).toISOString() });

const history: Record<string, ReturnType<typeof finished>[]> = {
    "beta-shop": [finished("b1", 10)],
    "acme-erp": [finished("a1", 40)],
    "acme-crm": [finished("a2", 30)],
    "acme-mail": [finished("a3", 30)],
};

vi.mock("@/services/dashboard/aggregates", async () => {
    const actual = await vi.importActual<typeof import("@/services/dashboard/aggregates")>("@/services/dashboard/aggregates");
    return { ...actual, getAggregates: vi.fn(), getRecentRunsByJob: vi.fn(async () => history) };
});
vi.mock("@/services/dashboard-service", () => ({ getLatestJobs: vi.fn().mockResolvedValue([]) }));

const { getAggregates } = await import("@/services/dashboard/aggregates");
const { invalidateDashboardCache } = await import("@/services/dashboard/cache");
const { getDashboardOverview } = await import("@/services/dashboard/overview-service");

const overviewJob = (id: string, tenantId: string, schedule: string) => ({
    id, name: id, tenantId, enabled: true, schedule, encryptionProfileId: null, schedulePreset: null,
    source: { adapterId: "postgres" }, sources: [], destinations: [],
});

type Where = { tenantId?: { not?: string } } | undefined;
const forOthers = (args: unknown) => Boolean((args as { where?: Where } | undefined)?.where?.tenantId?.not);

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    invalidateDashboardCache();
    vi.mocked(getAggregates).mockResolvedValue({
        timezone: "UTC", maxConcurrentJobs: 1, activity: [], calendar: { days: [], today: "2026-09-21" },
        successRate: { value: 100, previous: 100 }, succeeded24h: 0, failed24h: 0, total24h: 0, backedUp24h: 0, lastFailureAt: null, avgDurationMs: 0,
        storage: { entries: [], updatedAt: null, size: [], count: [] },
        runsByJob: { "beta-shop": history["beta-shop"] },
    } as never);
    prismaMock.execution.findMany.mockResolvedValue([] as never);
    prismaMock.adapterConfig.count.mockResolvedValue(0);
    prismaMock.adapterConfig.findMany.mockResolvedValue([] as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the Upcoming card in a tenant", () => {
    beforeEach(() => {
        prismaMock.job.findMany.mockImplementation((async (args: unknown) => forOthers(args)
            ? [
                // Acme backs up at 03:00 like Beta, and twice at noon, when Beta runs nothing.
                { id: "acme-erp", schedule: "0 3 * * *", schedulePreset: null },
                { id: "acme-crm", schedule: "0 12 * * *", schedulePreset: null },
                { id: "acme-mail", schedule: "0 12 * * *", schedulePreset: null },
            ]
            : [overviewJob("beta-shop", "beta", "0 3 * * *")]) as never);
    });

    it("marks the overlap of a run of the tenant with a run of another tenant, which the queue has one slot for", async () => {
        const { upcoming } = await runAsTenant("beta", () => getDashboardOverview());

        const starts = upcoming.conflicts.map((conflict) => Date.parse(conflict.from));
        expect(starts).toContain(Date.parse("2026-09-22T03:00:00.000Z"));
        expect(upcoming.conflicts.every((conflict) => conflict.demand === 2)).toBe(true);
    });

    it("leaves out an overlap among the runs of other tenants alone, and never lists their jobs", async () => {
        const { upcoming } = await runAsTenant("beta", () => getDashboardOverview());

        expect(upcoming.conflicts.some((conflict) => new Date(conflict.from).getUTCHours() === 12)).toBe(false);
        expect(upcoming.jobs).toEqual([expect.objectContaining({ id: "beta-shop", tenantId: "beta" })]);
        expect(upcoming.runs.every((run) => run.jobId === "beta-shop")).toBe(true);
        expect(JSON.stringify(upcoming)).not.toMatch(/acme/);
        expect(upcoming.conflicts.every((conflict) => Date.parse(conflict.to) - Date.parse(conflict.from) <= HOUR)).toBe(true);
    });
});

describe("the Upcoming card in All tenants", () => {
    it("names the tenant of every job, which the card shows beside its name", async () => {
        prismaMock.job.findMany.mockResolvedValue([overviewJob("beta-shop", "beta", "0 3 * * *"), overviewJob("acme-erp", "acme", "0 5 * * *")] as never);

        const { upcoming } = await getDashboardOverview();

        expect(Object.fromEntries(upcoming.jobs.map((job) => [job.id, job.tenantId]))).toEqual({ "beta-shop": "beta", "acme-erp": "acme" });
        // All tenants lists every job already, so nothing of other tenants is read on top.
        expect(prismaMock.job.findMany).toHaveBeenCalledTimes(1);
    });
});
