import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        adapterConfig: { findMany: vi.fn(), findFirst: vi.fn() },
        dbVersionHistory: { count: vi.fn(), findMany: vi.fn() },
        healthCheckLog: { findFirst: vi.fn(), count: vi.fn() },
        job: { findMany: vi.fn() },
        execution: { count: vi.fn() },
    },
    getBackups: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/services/storage/explorer-service", () => ({ storageExplorerService: { getBackups: (...args: unknown[]) => mocks.getBackups(...args) } }));

import { ServerExplorerService } from "@/services/databases/server-explorer-service";

const source = (id: string, name: string, adapterId: string, version: string, host: string) => ({
    id, name, adapterId, config: JSON.stringify({ host, port: adapterId === "postgres" ? 5432 : 3306 }), metadata: JSON.stringify({ engineVersion: version }),
});
const run = (jobKey: string, createdAt: string, engineVersion: string) => ({ jobKey, createdAt, path: `${jobKey}/${createdAt}.tar`, copies: [], file: { engineVersion } });

describe("the servers of the Servers tab", () => {
    beforeEach(() => {
        mocks.prisma.adapterConfig.findMany.mockResolvedValue([
            source("shop", "Shop cluster", "postgres", "16.4", "db.internal"),
            source("staging", "Staging", "postgres", "16.2", "staging.internal"),
            source("crm", "CRM", "mysql", "8.0.39", "crm.internal"),
        ]);
        mocks.prisma.dbVersionHistory.count.mockResolvedValue(2);
        mocks.prisma.healthCheckLog.findFirst.mockResolvedValue({ latencyMs: 4 });
        mocks.prisma.job.findMany.mockResolvedValue([{ id: "job-shop", sourceId: "shop" }, { id: "job-staging", sourceId: "staging" }]);
        mocks.getBackups.mockReset().mockResolvedValue({
            runs: [
                run("job-shop", "2026-09-26T03:00:00.000Z", "16.4"),
                run("job-shop", "2026-09-25T03:00:00.000Z", "16.4"),
                run("job-staging", "2026-09-20T03:00:00.000Z", "16.2"),
                // A deleted job has no server left.
                run("deleted:job-old", "2026-01-01T03:00:00.000Z", "15.6"),
            ],
        });
    });

    it("lists where each server runs, its kept backups and whether it is too old for the newest backups of its engine", async () => {
        const overview = await new ServerExplorerService().getServers({ withBackups: true });

        expect(overview).toMatchObject({ newVersions: 2, backups: true });
        expect(overview.servers[0]).toEqual({
            id: "shop", address: "db.internal:5432", latencyMs: 4, keptBackups: 2, lastBackupAt: "2026-09-26T03:00:00.000Z", behind: null,
        });
        expect(overview.servers[1]).toMatchObject({ id: "staging", keptBackups: 1, behind: { version: "16.4", serverName: "Shop cluster" } });
        expect(overview.servers[2]).toMatchObject({ id: "crm", keptBackups: 0, lastBackupAt: null, behind: null });
    });

    it("leaves out the backups for a viewer who may not see them, without reading the storage", async () => {
        const overview = await new ServerExplorerService().getServers({ withBackups: false });

        expect(overview.servers.every((server) => server.keptBackups === null && server.behind === null)).toBe(true);
        expect(mocks.getBackups).not.toHaveBeenCalled();
    });

    it("has one server for its page with the share of its checks of 30 days that passed", async () => {
        mocks.prisma.healthCheckLog.count.mockResolvedValueOnce(1000).mockResolvedValueOnce(999);

        await expect(new ServerExplorerService().getServer("shop", { withBackups: true })).resolves.toMatchObject({ id: "shop", uptime: 99.9 });
        await expect(new ServerExplorerService().getServer("gone", { withBackups: true })).resolves.toBeNull();
    });
});

describe("the versions of a server, a page at a time", () => {
    beforeEach(() => {
        mocks.prisma.adapterConfig.findFirst.mockResolvedValue({ id: "shop", metadata: JSON.stringify({ engineVersion: "16.4" }) });
        mocks.prisma.dbVersionHistory.findMany.mockResolvedValue([
            { previousVersion: null, newVersion: "15.6", detectedAt: new Date("2025-11-12T03:10:00Z") },
            { previousVersion: "15.6", newVersion: "16.2", detectedAt: new Date("2026-03-03T01:40:00Z") },
            { previousVersion: "16.2", newVersion: "16.4", detectedAt: new Date("2026-09-17T02:14:00Z") },
        ]);
        mocks.prisma.job.findMany.mockImplementation(async ({ where }: { where: { sourceId: unknown } }) => (
            typeof where.sourceId === "string" ? [{ id: "job-shop" }] : [{ id: "job-shop", sourceId: "shop" }]
        ));
        mocks.getBackups.mockReset().mockResolvedValue({
            runs: [
                run("job-shop", "2026-09-26T03:00:00.000Z", "16.4"),
                run("job-shop", "2026-09-10T03:00:00.000Z", "16.2"),
                run("job-shop", "2026-08-10T03:00:00.000Z", "16.2"),
            ],
        });
        mocks.prisma.execution.count.mockReset().mockImplementation(async ({ where }: { where: { startedAt: { gte?: Date } } }) => (
            where.startedAt.gte?.toISOString().startsWith("2026-09-17") ? 20 : 396
        ));
    });

    it("counts the backups made while each version of the page ran, and how many of them are kept", async () => {
        const page = await new ServerExplorerService().getVersions("shop", 1, 2, { withJobs: true, withBackups: true });

        expect(page).toMatchObject({ total: 3, page: 1, size: 2 });
        expect(page?.versions.map((period) => [period.version, period.kept, period.made])).toEqual([["16.4", 1, 20], ["16.2", 2, 396]]);
        // Only the versions of the page are counted.
        expect(mocks.prisma.execution.count).toHaveBeenCalledTimes(2);
    });

    it("has the oldest version on the last page, and no counts for a viewer who may see neither jobs nor backups", async () => {
        const page = await new ServerExplorerService().getVersions("shop", 2, 2, { withJobs: false, withBackups: false });

        expect(page?.versions).toEqual([expect.objectContaining({ version: "15.6", change: null, kept: null, made: null })]);
        expect(mocks.getBackups).not.toHaveBeenCalled();
        expect(mocks.prisma.execution.count).not.toHaveBeenCalled();
    });

    it("has no versions for a connection that is no database server", async () => {
        mocks.prisma.adapterConfig.findFirst.mockResolvedValue(null);

        await expect(new ServerExplorerService().getVersions("nas", 1, 5, { withJobs: true, withBackups: true })).resolves.toBeNull();
    });
});
