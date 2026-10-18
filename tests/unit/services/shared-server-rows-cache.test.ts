/**
 * The rows of the servers of other tenants on the Connections page are kept a minute, with the real
 * cache here. A database given or taken back shows at once all the same, since every change of who
 * holds a database counts in the key of the rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";
import type { SharedDatabase, SharedOverview } from "@/services/tenant/shared-databases";

const mocks = vi.hoisted(() => ({ overview: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/tenant/shared-databases", () => ({ sharedOverview: mocks.overview }));

const { sharedServerItems } = await import("@/services/sharing/shared-server-rows");
const { sharingChanged } = await import("@/services/tenant/shared-servers");
const { invalidateDashboardCache } = await import("@/services/dashboard/cache");

function database(databaseName: string): SharedDatabase {
    return {
        sourceId: "srv-mysql", serverName: "Shared MySQL", adapterId: "mysql", databaseName, providerName: "Skyfay Hosting",
        since: "2026-10-01T00:00:00.000Z", until: null, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null,
    };
}

const BOTH: SharedOverview = { databases: [database("acme_shop"), database("acme_crm")], backups: [] };
const TAKEN_BACK: SharedOverview = { databases: [database("acme_crm")], backups: [] };

const namesOf = async () => {
    const rows = await runAsTenant("acme", () => sharedServerItems("acme", { backups: true }));
    return rows.flatMap((row) => row.sharedServer.databases.map((entry) => entry.database.databaseName)).sort();
};

beforeEach(() => {
    vi.clearAllMocks();
    invalidateDashboardCache();
    prismaMock.databaseAssignment.count.mockResolvedValue(2);
    prismaMock.databaseAssignmentRule.count.mockResolvedValue(0);
    prismaMock.sharedBackupRequest.findMany.mockResolvedValue([]);
    prismaMock.execution.findMany.mockResolvedValue([]);
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);
    prismaMock.job.findMany.mockResolvedValue([]);
    prismaMock.databaseAssignmentRule.findMany.mockResolvedValue([]);
    prismaMock.tenant.findMany.mockResolvedValue([] as never);
});

describe("the rows of a tenant's shared servers", () => {
    it("are kept between two loads of the list", async () => {
        mocks.overview.mockResolvedValue(BOTH);
        expect(await namesOf()).toEqual(["acme_crm", "acme_shop"]);
        mocks.overview.mockResolvedValue(TAKEN_BACK);
        expect(await namesOf()).toEqual(["acme_crm", "acme_shop"]);
        expect(mocks.overview).toHaveBeenCalledTimes(1);
    });

    it("drop a database taken back at once, without waiting for the minute to pass", async () => {
        mocks.overview.mockResolvedValue(BOTH);
        expect(await namesOf()).toEqual(["acme_crm", "acme_shop"]);

        mocks.overview.mockResolvedValue(TAKEN_BACK);
        sharingChanged();
        expect(await namesOf()).toEqual(["acme_crm"]);
        expect(mocks.overview).toHaveBeenCalledTimes(2);
    });
});
