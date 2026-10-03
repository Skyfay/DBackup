import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        adapterConfig: { findMany: vi.fn() },
        job: { findMany: vi.fn() },
        execution: { findMany: vi.fn() },
        dbVersionHistory: { findMany: vi.fn() },
        databaseListCache: { upsert: vi.fn(), findMany: vi.fn() },
        systemSetting: { findUnique: vi.fn() },
    },
    registryGet: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...args: unknown[]) => mocks.registryGet(...args) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async () => ({ host: "db.internal" }) }));
// The host scope only hands its callback a host, which these adapters never touch.
vi.mock("@/lib/transport", () => ({ withHost: (_adapter: unknown, _config: unknown, run: (host: object) => unknown) => run({}) }));

import { DatabaseExplorerService } from "@/services/databases/database-explorer-service";
import { DatabaseListService } from "@/services/databases/database-list-service";

const source = { id: "s1", name: "Shop cluster", adapterId: "postgres", type: "database" } as never;

describe("reading the databases of a server", () => {
    beforeEach(() => {
        mocks.prisma.databaseListCache.upsert.mockReset().mockResolvedValue({});
    });

    it("keeps the list with its sizes and when it was read", async () => {
        mocks.registryGet.mockReturnValue({ getDatabasesWithStats: vi.fn().mockResolvedValue([{ name: "shop", sizeInBytes: 2048, tableCount: 46 }, { name: "" }]) });

        await new DatabaseListService().readSource(source);

        const call = mocks.prisma.databaseListCache.upsert.mock.calls[0][0];
        expect(call.where).toEqual({ adapterConfigId: "s1" });
        expect(JSON.parse(call.update.databasesJson)).toEqual([{ name: "shop", sizeInBytes: 2048, tableCount: 46 }]);
        expect(call.update.readAt).toBeInstanceOf(Date);
        expect(call.update.error).toBeNull();
    });

    it("falls back to the names alone for an adapter without sizes", async () => {
        mocks.registryGet.mockReturnValue({ getDatabases: vi.fn().mockResolvedValue(["crm"]) });

        await new DatabaseListService().readSource(source);

        expect(JSON.parse(mocks.prisma.databaseListCache.upsert.mock.calls[0][0].update.databasesJson)).toEqual([{ name: "crm" }]);
    });

    it("records why a read failed and keeps the list from before", async () => {
        mocks.registryGet.mockReturnValue({ getDatabasesWithStats: vi.fn().mockRejectedValue(new Error("permission denied for database shop")) });

        await new DatabaseListService().readSource(source);

        const call = mocks.prisma.databaseListCache.upsert.mock.calls[0][0];
        expect(call.update).toEqual({ error: "permission denied for database shop", attemptedAt: expect.any(Date) });
        expect(call.update).not.toHaveProperty("databasesJson");
    });

    it("leaves a connection alone whose adapter cannot list databases", async () => {
        mocks.registryGet.mockReturnValue({});
        await new DatabaseListService().readSource(source);
        expect(mocks.prisma.databaseListCache.upsert).not.toHaveBeenCalled();
    });
});

describe("the page model of the Database Explorer", () => {
    beforeEach(() => {
        mocks.prisma.adapterConfig.findMany.mockResolvedValue([{
            id: "s1",
            name: "Shop cluster",
            adapterId: "postgres",
            metadata: JSON.stringify({ engineVersion: "16.4" }),
            lastStatus: "ONLINE",
            databaseListCache: { databasesJson: JSON.stringify([{ name: "shop", sizeInBytes: 2048 }, { name: "analytics" }]), readAt: new Date("2026-09-27T09:00:00Z"), error: null },
            versionHistory: [{ previousVersion: "16.2", detectedAt: new Date("2026-09-17T02:14:00Z") }],
        }]);
        mocks.prisma.job.findMany.mockResolvedValue([
            { id: "nightly", name: "Shop nightly", sourceId: "s1", enabled: true, databases: '["shop"]', schedule: "0 3 * * *", schedulePreset: null },
        ]);
        mocks.prisma.execution.findMany.mockReset();
        mocks.prisma.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("lists every database with its server, the job that backs it up and its last backup", async () => {
        mocks.prisma.execution.findMany.mockResolvedValue([
            { id: "r1", jobId: "nightly", status: "Success", startedAt: new Date("2026-09-27T03:00:00Z"), size: BigInt(104), metadata: JSON.stringify({ names: ["shop"] }) },
        ]);

        const overview = await new DatabaseExplorerService().getOverview({ withJobs: true });

        expect(overview.servers[0]).toMatchObject({ id: "s1", version: "16.4", previousVersion: "16.2", readAt: "2026-09-27T09:00:00.000Z", readError: null });
        expect(overview.databases).toEqual([
            expect.objectContaining({ key: "s1/shop", sizeInBytes: 2048, jobIds: ["nightly"], lastBackup: expect.objectContaining({ executionId: "r1", size: 104 }) }),
            expect.objectContaining({ key: "s1/analytics", sizeInBytes: null, jobIds: [], lastBackup: null }),
        ]);
        expect(overview.coverage).toBe(true);
    });

    it("shows a Redis server as one entry with the keys of its numbered databases, backed up by every enabled job of it", async () => {
        mocks.prisma.adapterConfig.findMany.mockResolvedValue([{
            id: "cache",
            name: "Cache",
            adapterId: "redis",
            metadata: null,
            lastStatus: "ONLINE",
            databaseListCache: {
                databasesJson: JSON.stringify([{ name: "0", tableCount: 184332 }, { name: "1", tableCount: 0 }, { name: "2" }, { name: "3", tableCount: 12 }]),
                readAt: new Date("2026-09-27T09:00:00Z"),
                error: null,
            },
            versionHistory: [],
        }]);
        mocks.prisma.job.findMany.mockResolvedValue([
            // A Redis job backs up the whole server, whatever databases it names.
            { id: "cache-daily", name: "Cache daily", sourceId: "cache", enabled: true, databases: '["0"]', schedule: "0 21 * * *", schedulePreset: null },
            { id: "paused", name: "Paused", sourceId: "cache", enabled: false, databases: null, schedule: null, schedulePreset: null },
        ]);
        mocks.prisma.execution.findMany.mockImplementation(async ({ where }: { where: { jobId: string } }) => (where.jobId === "cache-daily"
            ? [{ id: "r7", jobId: "cache-daily", status: "Success", startedAt: new Date("2026-09-26T21:00:00Z"), size: BigInt(12), metadata: JSON.stringify({ names: ["0"] }) }]
            : []));

        const overview = await new DatabaseExplorerService().getOverview({ withJobs: true });

        expect(overview.databases).toEqual([expect.objectContaining({
            key: "cache",
            kind: "instance",
            name: "Cache",
            keyCount: 184344,
            logical: [{ name: "0", keys: 184332 }, { name: "3", keys: 12 }],
            emptyLogical: 2,
            jobIds: ["cache-daily"],
            lastBackup: expect.objectContaining({ executionId: "r7" }),
        })]);
    });

    it("leaves out the jobs and their runs for a viewer who may not see jobs", async () => {
        const overview = await new DatabaseExplorerService().getOverview({ withJobs: false });

        expect(overview.coverage).toBe(false);
        expect(overview.jobs).toEqual([]);
        expect(overview.databases.every((database) => database.jobIds.length === 0)).toBe(true);
        expect(mocks.prisma.job.findMany).not.toHaveBeenCalledWith(expect.anything());
        expect(mocks.prisma.execution.findMany).not.toHaveBeenCalled();
    });

    it("hands the timeline its runs, a failed one standing for what its job holds, the version changes and the planned runs", async () => {
        mocks.prisma.job.findMany.mockClear();
        mocks.prisma.execution.findMany.mockResolvedValue([
            { id: "r1", jobId: "nightly", status: "Success", startedAt: new Date("2026-09-26T03:00:00Z"), size: BigInt(104), metadata: JSON.stringify({ names: ["shop"], destinations: [{ name: "NAS", adapterId: "sftp", status: "success" }] }) },
            { id: "r2", jobId: "nightly", status: "Failed", startedAt: new Date("2026-09-27T03:00:00Z"), size: null, metadata: JSON.stringify({ progress: 10 }) },
        ]);
        mocks.prisma.dbVersionHistory.findMany.mockResolvedValue([{ adapterConfigId: "s1", previousVersion: "16.4", newVersion: "16.2", detectedAt: new Date("2026-09-26T12:00:00Z") }]);
        mocks.prisma.databaseListCache.findMany.mockResolvedValue([{ adapterConfigId: "s1", databasesJson: JSON.stringify([{ name: "shop" }, { name: "analytics" }]) }]);

        const result = await new DatabaseExplorerService().getRuns(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-29T00:00:00Z"), new Date("2026-09-27T10:00:00Z"));

        // Both runs held shop, so the list of names goes out once.
        expect(result.runs).toEqual([
            expect.objectContaining({ id: "r1", databases: 0, destinations: [{ name: "NAS", adapterId: "sftp", ok: true }], error: null }),
            expect.objectContaining({ id: "r2", status: "Failed", databases: 0 }),
        ]);
        expect(result.names).toEqual([["shop"]]);
        expect(result.versionChanges).toEqual([expect.objectContaining({ serverId: "s1", newVersion: "16.2", downgrade: true })]);
        expect(result.planned.map((entry) => entry.at)).toEqual(["2026-09-28T03:00:00.000Z"]);
    });

    it("hands the panel of a day the last error of each failed run, read only for those", async () => {
        mocks.prisma.execution.findMany.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => (select.logs
            ? [{ id: "r2", logs: JSON.stringify([{ level: "info", message: "Dumping shop" }, { level: "error", message: "pg_dump: timeout expired" }]) }]
            : [
                { id: "r1", jobId: "nightly", status: "Success", startedAt: new Date("2026-09-26T03:00:00Z"), endedAt: null, size: BigInt(104), path: "Shop/a.tar", metadata: JSON.stringify({ names: ["shop"] }) },
                { id: "r2", jobId: "nightly", status: "Failed", startedAt: new Date("2026-09-27T03:00:00Z"), endedAt: null, size: null, path: null, metadata: null },
            ]));
        mocks.prisma.dbVersionHistory.findMany.mockResolvedValue([]);
        mocks.prisma.databaseListCache.findMany.mockResolvedValue([]);

        const result = await new DatabaseExplorerService().getRuns(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-27T12:00:00Z"), new Date("2026-09-27T12:00:00Z"), { withErrors: true });

        expect(result.runs.find((entry) => entry.id === "r2")?.error).toBe("pg_dump: timeout expired");
        expect(result.runs.find((entry) => entry.id === "r1")).toMatchObject({ path: "Shop/a.tar", error: null });
        expect(mocks.prisma.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["r2"] } } }));
    });
});
