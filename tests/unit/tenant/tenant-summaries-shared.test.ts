// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    job: { groupBy: vi.fn() },
    execution: { groupBy: vi.fn(), findMany: vi.fn() },
    databaseListCache: { findMany: vi.fn() },
    databaseAssignment: { findMany: vi.fn() },
    databaseAssignmentRule: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

const { tenantSummaries } = await import("@/services/tenant/tenant-summaries");

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

beforeEach(() => {
    vi.clearAllMocks();
    db.job.groupBy.mockResolvedValue([]);
    db.execution.groupBy.mockResolvedValue([]);
    db.execution.findMany.mockResolvedValue([]);
    db.databaseListCache.findMany.mockImplementation((args: { where: Record<string, unknown> }) =>
        Promise.resolve("adapterConfigId" in args.where
            ? [{ adapterConfigId: "srv", databasesJson: LISTED }]
            : [{ databasesJson: LISTED, adapterConfig: { tenantId: "default" } }]),
    );
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
        expect(db.databaseListCache.findMany).toHaveBeenCalledTimes(1);
    });
});
