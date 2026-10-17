/**
 * The servers of other tenants as rows of the Connections page: one row per server with the
 * databases of it the tenant holds now, their backups, the schedule of the provider's job and the
 * patterns of the rules that give them, and nothing of the server but its name, engine and version.
 * A tenant without shared databases pays two counts and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import type { SharedBackup, SharedDatabase, SharedOverview } from "@/services/tenant/shared-databases";

const mocks = vi.hoisted(() => ({
    overview: vi.fn(),
    // Every load reads afresh here, the cache has tests of its own. The keys show when a load is kept.
    cached: vi.fn((_key: string, _ttl: number, load: () => Promise<unknown>) => load()),
}));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/tenant/shared-databases", () => ({ sharedOverview: mocks.overview }));
vi.mock("@/services/dashboard/cache", () => ({ cached: mocks.cached }));

const { mayHoldSharedDatabases, sharedServerItems, sharedServerRowId } = await import("@/services/sharing/shared-server-rows");

function database(databaseName: string, extra: Partial<SharedDatabase> = {}): SharedDatabase {
    return {
        sourceId: "srv-mysql", serverName: "Shared MySQL 8.0", adapterId: "mysql", databaseName, providerName: "Skyfay Hosting",
        since: "2026-10-01T00:00:00.000Z", until: null, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null, ...extra,
    };
}

function backup(id: string, of: SharedDatabase, createdAt: string, extra: Partial<SharedBackup> = {}): SharedBackup {
    return {
        id, sourceId: of.sourceId, databaseName: of.databaseName, databaseKey: `${of.sourceId}/${of.databaseName}`, createdAt, encrypted: true,
        verification: { at: createdAt, passed: true }, dump: { stored: 412, unpacked: 900 }, requestedBy: null, ...extra,
    };
}

const SHOP = database("acme_shop", { onDemand: { perDay: 4, usedToday: 2, active: null } });
const CRM = database("acme_crm", { since: "2026-10-09T00:00:00.000Z" });
const REPORTS = database("acme_reports", { sourceId: "srv-pg", serverName: "Shared Postgres 16", adapterId: "postgres" });
const FORMER = database("old_shop", { until: "2026-10-10T00:00:00.000Z" });
const GONE = database("lost_db", { sourceId: "srv-deleted", serverName: "Old MySQL", serverGone: true });

const OVERVIEW: SharedOverview = {
    databases: [CRM, SHOP, REPORTS, FORMER, GONE],
    backups: [
        backup("b5", SHOP, "2026-10-17T02:14:00.000Z"),
        backup("b4", SHOP, "2026-10-16T15:42:00.000Z", { requestedBy: { name: "Sara Nguyen" } }),
        backup("r1", REPORTS, "2026-10-16T01:30:00.000Z"),
        backup("b3", CRM, "2026-10-16T02:13:00.000Z", { verification: { at: "2026-10-16T03:00:00.000Z", passed: false } }),
        backup("b2", SHOP, "2026-10-16T02:13:00.000Z"),
        backup("b0", FORMER, "2026-10-09T02:13:00.000Z"),
    ],
};

/** What the server of the provider holds: an address, a login and a secret, none of which may leave. */
const SERVER_METADATA = JSON.stringify({ engineVersion: "8.0.36", host: "10.0.0.5", port: 3306, user: "root", password: "s3cret-pass" });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue(OVERVIEW);
    prismaMock.databaseAssignment.count.mockResolvedValue(2);
    prismaMock.databaseAssignmentRule.count.mockResolvedValue(0);
    prismaMock.sharedBackupRequest.findMany.mockResolvedValue([]);
    prismaMock.execution.findMany.mockResolvedValue([]);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
        { id: "srv-mysql", metadata: SERVER_METADATA, config: JSON.stringify({ host: "10.0.0.5", password: "s3cret-pass" }) },
        { id: "srv-pg", metadata: JSON.stringify({ engineVersion: "16.4" }) },
    ] as never);
    prismaMock.job.findMany.mockResolvedValue([
        // Backs up another database only, so it says nothing about these.
        { sourceId: "srv-mysql", databases: JSON.stringify(["billing"]), enabled: true, schedule: "0 5 * * *", schedulePreset: null },
        // Switched off, so it backs up nothing on a schedule.
        { sourceId: "srv-mysql", databases: "[]", enabled: false, schedule: "0 1 * * *", schedulePreset: null },
        { sourceId: "srv-mysql", databases: "[]", enabled: true, schedule: "0 3 * * *", schedulePreset: { schedule: "0 2 * * *" } },
        { sourceId: "srv-pg", databases: JSON.stringify(["acme_reports"]), enabled: true, schedule: "30 1 * * *", schedulePreset: null },
    ] as never);
    prismaMock.databaseAssignmentRule.findMany.mockResolvedValue([]);
});

describe("a tenant without shared databases", () => {
    it("pays two counts and never reads the shared servers", async () => {
        prismaMock.databaseAssignment.count.mockResolvedValue(0);
        prismaMock.databaseAssignmentRule.count.mockResolvedValue(0);

        expect(await sharedServerItems("acme", { backups: true })).toEqual([]);
        expect(await mayHoldSharedDatabases("acme")).toBe(false);
        expect(mocks.overview).not.toHaveBeenCalled();
        expect(prismaMock.sharedBackupRequest.findMany).not.toHaveBeenCalled();
    });

    it("counts only the assignments and rules of the tenant that have not ended", async () => {
        const now = new Date("2026-10-17T12:00:00.000Z");
        await mayHoldSharedDatabases("acme", now);

        const open = { tenantId: "acme", OR: [{ validUntil: null }, { validUntil: { gt: now } }] };
        expect(prismaMock.databaseAssignment.count.mock.calls[0][0]?.where).toEqual(open);
        expect(prismaMock.databaseAssignmentRule.count.mock.calls[0][0]?.where).toEqual(open);
    });
});

describe("the rows of the provided servers", () => {
    it("are one per server with the databases the tenant holds there now, never a former one or one of a deleted server", async () => {
        const rows = await sharedServerItems("acme", { backups: true });

        expect(rows.map((row) => [row.id, row.name, row.adapterId])).toEqual([
            [sharedServerRowId("srv-mysql"), "Shared MySQL 8.0", "mysql"],
            [sharedServerRowId("srv-pg"), "Shared Postgres 16", "postgres"],
        ]);
        expect(rows[0].sharedServer.databases.map((entry) => entry.database.databaseName)).toEqual(["acme_crm", "acme_shop"]);
        expect(rows[1].sharedServer.databases.map((entry) => entry.database.databaseName)).toEqual(["acme_reports"]);
        // The row is the tenant's since its first database became theirs.
        expect(rows[0].createdAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    });

    it("count the backups over the databases of the server and keep the newest of each", async () => {
        const [mysql] = await sharedServerItems("acme", { backups: true });
        const [crm, shop] = mysql.sharedServer.databases;

        expect(mysql.sharedServer.backups).toBe(4);
        expect(mysql.sharedServer.lastBackup).toEqual({ at: "2026-10-17T02:14:00.000Z", passed: true });
        expect(shop.backups).toBe(3);
        expect(shop.newest?.id).toBe("b5");
        expect(crm.lastBackup).toEqual({ at: "2026-10-16T02:13:00.000Z", passed: false });
        expect(shop.database.onDemand).toEqual({ perDay: 4, usedToday: 2, active: null });
    });

    it("take the schedule of the enabled job that backs the databases up, through its preset", async () => {
        const [mysql, pg] = await sharedServerItems("acme", { backups: true });
        expect(mysql.sharedServer.schedule).toBe("0 2 * * *");
        expect(pg.sharedServer.schedule).toBe("30 1 * * *");
    });

    it("hand on the pattern of a rule that gives the tenant databases, and nothing else of it", async () => {
        prismaMock.databaseAssignmentRule.findMany.mockResolvedValue([{ sourceId: "srv-mysql", pattern: "acme_*", onDemandPerDay: 4 }] as never);
        const [mysql, pg] = await sharedServerItems("acme", { backups: true });

        expect(mysql.sharedServer.rules).toEqual([{ pattern: "acme_*", perDay: 4 }]);
        expect(pg.sharedServer.rules).toEqual([]);
        const query = prismaMock.databaseAssignmentRule.findMany.mock.calls[0][0];
        expect(query?.where).toMatchObject({ tenantId: "acme", sourceId: { in: ["srv-mysql", "srv-pg"] } });
        expect(query?.select).toEqual({ sourceId: true, pattern: true, onDemandPerDay: true });
    });

    it("leave the newest backups out for a viewer who may not see backups, and keep the counts", async () => {
        const [mysql] = await sharedServerItems("acme", { backups: false });
        expect(mysql.sharedServer.databases.map((entry) => entry.newest)).toEqual([null, null]);
        expect(mysql.sharedServer.backups).toBe(4);
    });

    it("hand out nothing of the provider's server but its name, engine and version", async () => {
        const rows = await sharedServerItems("acme", { backups: true });
        const json = JSON.stringify(rows);

        for (const row of rows) {
            expect(row.config).toBe("{}");
            expect(row.secretStatus).toEqual({});
            expect(row.primaryCredentialId).toBeNull();
            expect(row.sshCredentialId).toBeNull();
            expect(row.lastError).toBeNull();
            expect(row.lastHealthCheck).toBeNull();
        }
        expect(JSON.parse(rows[0].metadata ?? "{}")).toEqual({ engineVersion: "8.0.36" });
        expect(json).not.toContain("10.0.0.5");
        expect(json).not.toContain("3306");
        expect(json).not.toContain("s3cret-pass");
        expect(json).not.toContain("root");
        // Only the version of a server is read from its row, never its config.
        expect(prismaMock.adapterConfig.findMany.mock.calls[0][0]?.select).toEqual({ id: true, metadata: true });
    });

    it("are left out when the shared servers cannot be read, so the own connections still list", async () => {
        mocks.overview.mockRejectedValue(new Error("listing unreadable"));
        expect(await sharedServerItems("acme", { backups: true })).toEqual([]);
    });

    it("are kept a while, and loaded again once a backup the tenant started begins or ends", async () => {
        const keyNow = async () => {
            await sharedServerItems("acme", { backups: true });
            return mocks.cached.mock.calls.at(-1)?.[0];
        };
        const idle = await keyNow();
        expect(await keyNow()).toBe(idle);

        prismaMock.sharedBackupRequest.findMany.mockResolvedValue([{ id: "req-1", executionId: "run-1" }] as never);
        prismaMock.execution.findMany.mockResolvedValue([{ id: "run-1", status: "Pending" }] as never);
        const queued = await keyNow();
        prismaMock.execution.findMany.mockResolvedValue([{ id: "run-1", status: "Running" }] as never);
        const running = await keyNow();
        prismaMock.execution.findMany.mockResolvedValue([{ id: "run-1", status: "Success" }] as never);
        const done = await keyNow();

        expect(new Set([idle, queued, running, done]).size).toBe(4);
        expect(idle).toContain("acme");
    });
});
