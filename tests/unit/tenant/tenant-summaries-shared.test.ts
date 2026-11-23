// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    job: { findMany: vi.fn() },
    adapterConfig: { findMany: vi.fn() },
    execution: { findMany: vi.fn() },
    databaseListCache: { findMany: vi.fn() },
    databaseAssignment: { findMany: vi.fn() },
    databaseAssignmentRule: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

const { tenantSummaries } = await import("@/services/tenant/tenant-summaries");
const { invalidateDashboardCache, invalidateTenantCaches } = await import("@/services/dashboard/cache");
const { sharingChanged } = await import("@/services/tenant/shared-servers");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The home tenant shares its server srv, which lists four databases and has one of its own. */
const LISTED = JSON.stringify([{ name: "shop_acme" }, { name: "shop_globex" }, { name: "inventory" }, "crm"]);

const ASSIGNMENTS = [
    // Given to Acme by name, which wins over the rule of Globex.
    { sourceId: "srv", databaseName: "shop_acme", tenantId: "acme", validFrom: day("2026-01-01"), validUntil: null, movedToSourceId: null, createdAt: day("2026-01-01") },
    // Given to Acme once and taken back since.
    { sourceId: "srv", databaseName: "inventory", tenantId: "acme", validFrom: day("2026-01-01"), validUntil: day("2026-02-01"), movedToSourceId: null, createdAt: day("2026-01-01") },
];
const RULES = [
    { sourceId: "srv", id: "r1", pattern: "shop_*", tenantId: "globex", priority: 0, validFrom: day("2026-01-01"), validUntil: null, createdAt: day("2026-01-01") },
];

/** The raw queries: the length of each listed server, and the newest finished backup of each job. */
const raw = vi.hoisted(() => ({ counts: [] as { id: string; count: number }[], newest: [] as { id: string }[] }));

beforeEach(() => {
    vi.clearAllMocks();
    invalidateDashboardCache();
    raw.counts = [{ id: "srv", count: 4 }];
    raw.newest = [];
    db.job.findMany.mockResolvedValue([]);
    db.adapterConfig.findMany.mockResolvedValue([{ id: "srv", tenantId: "default" }]);
    db.execution.findMany.mockResolvedValue([]);
    db.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join("?").includes("DatabaseListCache") ? raw.counts : raw.newest));
    db.databaseListCache.findMany.mockResolvedValue([{ adapterConfigId: "srv", databasesJson: LISTED }]);
    db.databaseAssignment.findMany.mockImplementation((args: { distinct?: string[] }) =>
        Promise.resolve(args.distinct ? [{ sourceId: "srv" }] : ASSIGNMENTS),
    );
    db.databaseAssignmentRule.findMany.mockImplementation((args: { distinct?: string[] }) =>
        Promise.resolve(args.distinct ? [{ sourceId: "srv" }] : RULES),
    );
});

describe("the summaries of the tenants", () => {
    it("count the databases each tenant holds now on a shared server, by name or by a rule", async () => {
        const summaries = await tenantSummaries(["default", "acme", "globex"]);

        expect(summaries.map(({ id, databases, shared }) => ({ id, databases, shared }))).toEqual([
            { id: "default", databases: 4, shared: 0 },
            { id: "acme", databases: 0, shared: 1 },
            { id: "globex", databases: 0, shared: 1 },
        ]);
    });

    it("read no list of a server while no tenant holds a database of another", async () => {
        db.databaseAssignment.findMany.mockResolvedValue([]);
        db.databaseAssignmentRule.findMany.mockResolvedValue([]);

        const summaries = await tenantSummaries(["acme"]);

        expect(summaries[0].shared).toBe(0);
        expect(db.databaseListCache.findMany).not.toHaveBeenCalled();
    });

    it("count the jobs and mark a tenant by the newest finished backup of its jobs, a failure over a missed copy", async () => {
        db.job.findMany.mockResolvedValue([
            { id: "a1", tenantId: "acme" }, { id: "a2", tenantId: "acme" }, { id: "g1", tenantId: "globex" }, { id: "d1", tenantId: "default" },
        ]);
        raw.newest = [{ id: "run-a1" }, { id: "run-a2" }, { id: "run-g1" }, { id: "run-d1" }];
        // Of the newest runs, the client reads those that failed or missed a copy.
        db.execution.findMany.mockResolvedValue([
            { tenantId: "acme", status: "Partial" }, { tenantId: "acme", status: "Failed" }, { tenantId: "globex", status: "Partial" },
        ]);

        const summaries = await tenantSummaries(["default", "acme", "globex"]);

        expect(summaries.map(({ id, jobs, health }) => ({ id, jobs, health }))).toEqual([
            { id: "default", jobs: 1, health: null },
            { id: "acme", jobs: 2, health: "failed" },
            { id: "globex", jobs: 1, health: "partial" },
        ]);
        expect(db.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: { in: ["run-a1", "run-a2", "run-g1", "run-d1"] } },
        }));
    });

    it("are kept for the same tenants in any order until a run ends or a database changes hands", async () => {
        await tenantSummaries(["acme", "globex"]);
        const again = await tenantSummaries(["globex", "acme"]);

        expect(again.map((summary) => summary.id)).toEqual(["globex", "acme"]);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);

        // A run of any tenant ends, which the system scope of the summaries counts.
        invalidateTenantCaches(["initech"]);
        await tenantSummaries(["acme", "globex"]);
        expect(db.job.findMany).toHaveBeenCalledTimes(2);

        sharingChanged();
        await tenantSummaries(["acme", "globex"]);
        expect(db.job.findMany).toHaveBeenCalledTimes(3);
    });
});
