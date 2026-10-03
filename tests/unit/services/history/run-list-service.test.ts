import { beforeEach, describe, expect, it, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { buildRunWhere, getRunFacets, getRunOptions, getRunStats, listRuns } from "@/services/history/run-list-service";
import { record } from "./run-fixtures";

// groupBy has overloads a deep mock cannot type, so it is driven as a plain mock.
const groupBy = prismaMock.execution.groupBy as unknown as Mock;

beforeEach(() => {
    invalidateDashboardCache();
    prismaMock.execution.findMany.mockReset();
    prismaMock.execution.findUnique.mockReset();
    groupBy.mockReset();
});

describe("buildRunWhere", () => {
    it("matches any of the types, states, jobs and people, and searches jobs, types and paths", () => {
        const where = buildRunWhere({ types: ["Backup"], statuses: ["Failed", "Partial"], jobIds: ["j1"], starters: ["schedule", "manual:Manu", "api:"], search: "shop" });
        expect(where).toEqual({
            AND: [
                { type: { in: ["Backup"] } },
                { status: { in: ["Failed", "Partial"] } },
                { jobId: { in: ["j1"] } },
                { OR: [{ triggerType: "Scheduler" }, { triggerType: "Manual", triggerLabel: "Manu" }, { triggerType: "Api", OR: [{ triggerLabel: null }, { triggerLabel: "" }] }] },
                { OR: [{ job: { is: { name: { contains: "shop" } } } }, { type: { contains: "shop" } }, { path: { contains: "shop" } }] },
            ],
        });
    });

    it("leaves out the filter it counts for", () => {
        expect(buildRunWhere({ types: ["Backup"], statuses: ["Failed"] }, "statuses")).toEqual({ AND: [{ type: { in: ["Backup"] } }] });
        expect(buildRunWhere({})).toEqual({});
    });
});

describe("listRuns", () => {
    it("returns the rows of a page with the usual time of their job and the error of a failed run in plain words", async () => {
        const failed = record({ id: "failed-1", status: "Failed", jobId: "job-shop", job: { name: "Shop nightly", source: { adapterId: "postgres" }, sources: [] }, metadata: JSON.stringify({ stage: "Dumping Databases" }) });
        prismaMock.execution.findMany
            .mockResolvedValueOnce([record(), failed] as never)
            // The last successful runs of each job, for its usual time.
            .mockResolvedValueOnce([
                { startedAt: new Date(0), endedAt: new Date(400_000) },
                { startedAt: new Date(0), endedAt: new Date(500_000) },
            ] as never)
            .mockResolvedValueOnce([] as never);
        prismaMock.execution.count.mockResolvedValue(2);
        prismaMock.execution.findUnique.mockResolvedValue({ logs: JSON.stringify([{ level: "error", message: "pg_dump: error: connection to server at \"db\" failed: timeout expired" }]) } as never);

        const page = await listRuns({ page: 1, pageSize: 25 });

        expect(page.total).toBe(2);
        expect(page.rows[0]).toMatchObject({ id: "run-1", name: "Shop offsite", usualMs: 450_000, note: "2 of 2 copies" });
        expect(page.rows[1]).toMatchObject({ id: "failed-1", status: "Failed", note: "Could not reach the server" });
    });
});

describe("getRunFacets", () => {
    it("counts the runs of every type, state, job and person under the other filters", async () => {
        groupBy
            .mockResolvedValueOnce([{ type: "Backup", _count: { _all: 5 } }] as never)
            .mockResolvedValueOnce([{ status: "Failed", _count: { _all: 2 } }] as never)
            .mockResolvedValueOnce([{ jobId: "j1", _count: { _all: 4 } }, { jobId: null, _count: { _all: 1 } }] as never)
            .mockResolvedValueOnce([{ triggerType: "Manual", triggerLabel: "Manu", _count: { _all: 3 } }, { triggerType: "Scheduler", triggerLabel: "Scheduler", _count: { _all: 2 } }] as never);
        expect(await getRunFacets({})).toEqual({ type: { Backup: 5 }, status: { Failed: 2 }, job: { j1: 4 }, starter: { "manual:Manu": 3, schedule: 2 } });
    });
});

describe("getRunOptions", () => {
    it("lists every job and everyone who started a run, the schedule first", async () => {
        prismaMock.job.findMany.mockResolvedValue([{ id: "j1", name: "Shop nightly", source: { adapterId: "postgres" } }] as never);
        groupBy.mockResolvedValue([
            { triggerType: "Api", triggerLabel: "CI deploy", _count: { _all: 1 } },
            { triggerType: "Scheduler", triggerLabel: "Scheduler", _count: { _all: 9 } },
            { triggerType: "Manual", triggerLabel: "Manu", _count: { _all: 2 } },
        ] as never);
        const options = await getRunOptions();
        expect(options.jobs).toEqual([{ id: "j1", name: "Shop nightly", adapterId: "postgres" }]);
        expect(options.starters.map((starter) => [starter.label, starter.group])).toEqual([["Schedule", "System"], ["Manu", "By hand"], ["CI deploy", "API keys"]]);
    });
});

describe("getRunStats", () => {
    it("counts the last 30 days and names what runs and waits", async () => {
        groupBy.mockResolvedValue([{ status: "Success", _count: { _all: 8 } }, { status: "Failed", _count: { _all: 1 } }, { status: "Partial", _count: { _all: 1 } }] as never);
        prismaMock.execution.findFirst
            .mockResolvedValueOnce(record({ status: "Failed", job: { name: "Shop nightly", source: null, sources: [] } }) as never)
            .mockResolvedValueOnce(null);
        prismaMock.execution.findMany.mockResolvedValue([record({ status: "Running", job: { name: "CRM daily", source: null, sources: [] } }), record({ status: "Pending" })] as never);
        const stats = await getRunStats(new Date("2026-09-27T10:00:00.000Z"));
        expect(stats).toMatchObject({ total: 10, succeeded: 8, failed: 1, partial: 1, running: ["CRM daily"], queued: ["Shop offsite"], lastPartial: null });
        expect(stats.lastFailed?.name).toBe("Shop nightly");
    });
});
