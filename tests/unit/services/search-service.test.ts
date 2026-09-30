import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { searchRecords } = await import("@/services/search/search-service");

const ALL = { jobs: true, runs: true, databases: true, connections: ["database", "storage", "notification"] as ("database" | "storage" | "notification")[] };
const NONE = { jobs: false, runs: false, databases: false, connections: [] };

describe("the search over the records of DBackup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.job.findMany.mockResolvedValue([] as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([] as never);
        prismaMock.databaseListCache.findMany.mockResolvedValue([] as never);
        prismaMock.execution.findMany.mockResolvedValue([] as never);
    });

    it("asks nothing for a single letter", async () => {
        expect(await searchRecords("m", ALL)).toEqual([]);
        expect(prismaMock.job.findMany).not.toHaveBeenCalled();
    });

    it("finds jobs by name with the schedule they follow and how their last finished run went", async () => {
        prismaMock.job.findMany.mockResolvedValue([
            { id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", schedulePreset: null, source: { adapterId: "mysql" } },
            { id: "j2", name: "MySQL weekly", enabled: false, schedule: "0 3 * * 0", schedulePreset: { schedule: "0 4 * * 0" }, source: null },
        ] as never);
        prismaMock.execution.findFirst.mockResolvedValueOnce({ status: "Failed" } as never).mockResolvedValueOnce(null);

        const hits = await searchRecords(" mysql ", { ...NONE, jobs: true });

        expect(prismaMock.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { contains: "mysql" } } }));
        expect(prismaMock.execution.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j1", status: { in: ["Success", "Failed", "Partial"] } } }));
        expect(hits).toEqual([
            { kind: "job", id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: "Failed" },
            { kind: "job", id: "j2", name: "MySQL weekly", enabled: false, schedule: "0 4 * * 0", adapterId: null, lastStatus: null },
        ]);
    });

    it("finds only the connections of the types the viewer may see", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "c1", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, lastStatus: "OFFLINE" }] as never);

        const hits = await searchRecords("prod", { ...NONE, connections: ["database"] });

        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { contains: "prod" }, type: { in: ["database"] } } }));
        expect(hits).toEqual([{ kind: "connection", id: "c1", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, status: "OFFLINE" }]);
    });

    it("finds the databases in the lists read from the servers, regardless of case, and skips a list it cannot read", async () => {
        prismaMock.databaseListCache.findMany.mockResolvedValue([
            { adapterConfigId: "s1", databasesJson: JSON.stringify([{ name: "shop", sizeInBytes: 2048 }, { name: "Shop_archive" }, { name: "wiki" }]), adapterConfig: { name: "db-prod", adapterId: "mysql" } },
            { adapterConfigId: "s2", databasesJson: "not json", adapterConfig: { name: "broken", adapterId: "postgres" } },
        ] as never);

        const hits = await searchRecords("SHOP", { ...NONE, databases: true });

        expect(hits).toEqual([
            { kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "shop", sizeInBytes: 2048 },
            { kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "Shop_archive", sizeInBytes: null },
        ]);
    });

    it("finds the latest runs of a job by its name", async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "r1", status: "Failed", startedAt: new Date("2026-09-30T02:00:00.000Z"), job: { name: "Nightly MySQL", source: { adapterId: "mysql" } } },
        ] as never);

        const hits = await searchRecords("nightly", { ...NONE, runs: true });

        expect(hits).toEqual([{ kind: "run", id: "r1", name: "Nightly MySQL", status: "Failed", startedAt: "2026-09-30T02:00:00.000Z", adapterId: "mysql" }]);
    });

    it("searches no kind the viewer may not see", async () => {
        expect(await searchRecords("mysql", NONE)).toEqual([]);
        expect(prismaMock.job.findMany).not.toHaveBeenCalled();
        expect(prismaMock.adapterConfig.findMany).not.toHaveBeenCalled();
        expect(prismaMock.databaseListCache.findMany).not.toHaveBeenCalled();
        expect(prismaMock.execution.findMany).not.toHaveBeenCalled();
    });
});
