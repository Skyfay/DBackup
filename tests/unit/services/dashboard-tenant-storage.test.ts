/**
 * What the Overview counts and names for the tenants of a destination one tenant shares with its
 * customers, and for a run of a customer that has no job of its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/storage/storage-alert-service", () => ({ checkStorageAlerts: vi.fn() }));
vi.mock("@/services/sharing/provided", () => ({ providedIds: vi.fn(), providedTo: vi.fn() }));

import { getLatestJobs, getStorageVolume, refreshStorageStatsCache, type StorageVolumeEntry } from "@/services/dashboard-service";
import { deriveHealth } from "@/services/dashboard/health";
import { registry } from "@/lib/core/registry";
import { providedIds, providedTo } from "@/services/sharing/provided";
import { runAsTenant } from "@/lib/tenant/context";

const MSP_S3 = { id: "msp-s3", name: "MSP S3", adapterId: "s3", type: "storage", storageRole: "DESTINATION", config: "{}", tenantId: "msp" };

/** The storage cache in the settings table, so a refresh reads what the one before wrote. */
let stored: StorageVolumeEntry[] | null;

beforeEach(() => {
    vi.clearAllMocks();
    stored = null;
    prismaMock.systemSetting.findUnique.mockImplementation((async ({ where }: { where: { key: string } }) =>
        where.key === "cache.storageVolume" && stored ? { key: where.key, value: JSON.stringify(stored) } : null) as never);
    prismaMock.systemSetting.upsert.mockImplementation((({ where, update }: { where: { key: string }; update: { value: string } }) => {
        if (where.key === "cache.storageVolume") stored = JSON.parse(update.value);
        return {} as never;
    }) as never);
    prismaMock.$transaction.mockImplementation((async (operations: unknown) => (Array.isArray(operations) ? Promise.all(operations) : operations)) as never);
    prismaMock.storageSnapshot.createMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.storageSnapshot.findMany.mockResolvedValue([]);
});

describe("a customer whose backups on a shared destination are all gone", () => {
    beforeEach(() => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([MSP_S3] as never);
        prismaMock.connectionShare.findMany.mockResolvedValue([{ id: "msp-s3" }] as never);
        prismaMock.tenant.findMany.mockImplementation((async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.filter((id) => id !== "gone").map((id) => ({ id }))) as never);
        vi.mocked(providedIds).mockImplementation(async (tenantId: string, ids: readonly string[]) =>
            new Set(tenantId === "acme" || tenantId === "gone" ? ids : []));
        stored = [
            { configId: "msp-s3", tenantId: "msp", name: "MSP S3", adapterId: "s3", size: 50, count: 1 },
            { configId: "msp-s3", tenantId: "acme", name: "MSP S3", adapterId: "s3", size: 700, count: 3 },
        ];
    });

    it("counts zero for it and stores a snapshot of nothing, so its trend drops with the backups", async () => {
        vi.mocked(registry.get).mockReturnValue({ list: vi.fn().mockResolvedValue([{ name: "own.tar", path: "nightly/own.tar", size: 50 }]) } as never);

        const result = await refreshStorageStatsCache();

        expect(result.map((entry) => [entry.tenantId, entry.size, entry.count])).toEqual([["msp", 50, 1], ["acme", 0, 0]]);
        expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ tenantId: "msp", size: BigInt(50), count: 1 }),
                expect.objectContaining({ tenantId: "acme", size: BigInt(0), count: 0 }),
            ],
        });
    });

    it("leaves out a tenant that no longer gets the destination or is gone", async () => {
        stored = [...stored!, { configId: "msp-s3", tenantId: "shop", name: "MSP S3", adapterId: "s3", size: 90, count: 1 }, { configId: "msp-s3", tenantId: "gone", name: "MSP S3", adapterId: "s3", size: 10, count: 1 }];
        vi.mocked(registry.get).mockReturnValue({ list: vi.fn().mockResolvedValue([]) } as never);

        const result = await refreshStorageStatsCache();

        expect(result.map((entry) => entry.tenantId)).toEqual(["msp", "acme"]);
    });
});

describe("the last scan when no cache exists and the refresh fails", () => {
    const ACME_NAS = { id: "acme-nas", name: "Acme NAS", adapterId: "local", type: "storage", storageRole: "DESTINATION", config: "{}", tenantId: "acme" };

    beforeEach(() => {
        // The refresh fails at its first read, the fallback and the read of what the scope sees answer.
        prismaMock.adapterConfig.findMany
            .mockRejectedValueOnce(new Error("Refresh failed"))
            .mockResolvedValue([ACME_NAS] as never);
        prismaMock.storageSnapshot.findFirst.mockImplementation((async ({ where }: { where: { adapterConfigId: string; tenantId: string } }) => ({
            size: BigInt(where.adapterConfigId === "acme-nas" ? 100 : 700), count: 1, createdAt: new Date("2026-10-16T05:00:00.000Z"),
        })) as never);
    });

    it("shows a customer its own destinations and the ones another tenant shares with it", async () => {
        vi.mocked(providedTo).mockResolvedValue([{ ...MSP_S3, providerId: "msp", providerName: "MSP" }] as never);
        vi.mocked(providedIds).mockResolvedValue(new Set(["msp-s3"]));

        const result = await runAsTenant("acme", () => getStorageVolume());

        expect(result.map((entry) => [entry.configId, entry.tenantId, entry.size, entry.scanError])).toEqual([
            ["acme-nas", "acme", 100, true],
            ["msp-s3", "acme", 700, true],
        ]);
        expect(providedTo).toHaveBeenCalledWith("acme", { kind: "destination" });
        expect(prismaMock.storageSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { adapterConfigId: "msp-s3", tenantId: "acme" } }));
    });
});

describe("the latest executions of the Overview", () => {
    it("name a customer's backup and restore of a shared database like the History page, with their tenant", async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            {
                id: "backup-run", type: "Backup", status: "Success", tenantId: "acme", jobId: null, job: null, path: null, size: null,
                startedAt: new Date("2026-10-17T10:00:00Z"), endedAt: new Date("2026-10-17T10:01:00Z"),
                metadata: JSON.stringify({ backupOf: { database: "shop_acme", provider: "MSP" }, target: { name: "Shared MySQL", adapterId: "mysql" } }),
            },
            {
                id: "restore-run", type: "Restore", status: "Failed", tenantId: "acme", jobId: null, job: null, path: null, size: null,
                startedAt: new Date("2026-10-17T09:00:00Z"), endedAt: new Date("2026-10-17T09:02:00Z"),
                metadata: JSON.stringify({ restoreOf: { database: "shop_acme" }, target: { name: "Shared MySQL", adapterId: "mysql" } }),
            },
        ] as never);

        const result = await getLatestJobs(2);

        expect(result.map((entry) => [entry.jobName, entry.sub, entry.tenantId])).toEqual([
            ["Backup of shop_acme", "Backup · on Shared MySQL", "acme"],
            ["Restore onto Shared MySQL", "Restore of shop_acme", "acme"],
        ]);
    });
});

describe("the next run of the healthy banner", () => {
    it("names the tenant of its job, which All tenants shows", () => {
        const health = deriveHealth(
            [{ id: "job-1", name: "Nightly", tenantId: "acme", enabled: true, nextRunAt: "2026-10-18T03:00:00.000Z" }],
            new Map([["job-1", [{ id: "run-1", status: "Success", startedAt: "2026-10-17T03:00:00.000Z", endedAt: "2026-10-17T03:01:00.000Z" }]]]),
        );

        expect(health).toEqual(expect.objectContaining({ state: "healthy", nextRun: { jobName: "Nightly", at: "2026-10-18T03:00:00.000Z", tenantId: "acme" } }));
    });
});
