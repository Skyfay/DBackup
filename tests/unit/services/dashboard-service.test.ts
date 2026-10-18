import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/logging/errors", () => ({
  wrapError: (e: unknown) => e,
}));

vi.mock("@/lib/adapters", () => ({
  registerAdapters: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptConfig: (input: unknown) => input,
}));

vi.mock("@/lib/core/registry", () => ({
  registry: { get: vi.fn() },
}));

vi.mock("@/lib/adapters/config-resolver", () => ({
  resolveAdapterConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/services/storage/storage-alert-service", () => ({
  checkStorageAlerts: vi.fn(),
}));

// The destinations other tenants share with a tenant, which the sharing module reads across tenants.
vi.mock("@/services/sharing/provided", () => ({
  providedIds: vi.fn(),
}));

import {
  getDashboardStats,
  getActivityData,
  getStorageVolume,
  getStorageVolumeCacheAge,
  refreshStorageStatsCache,
  getLatestJobs,
  hasRunningJobs,
} from "@/services/dashboard-service";
import { registry } from "@/lib/core/registry";
import { providedIds } from "@/services/sharing/provided";
import { explicitScope, runAsTenant, type TenantScope } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------

describe("getDashboardStats", () => {
  beforeEach(() => {
    // Provide a pre-populated storage cache so getStorageVolume() returns fast
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "cache.storageVolume",
      value: JSON.stringify([
        { configId: "cfg-1", name: "Local", adapterId: "local", size: 2048, count: 4 },
      ]),
    } as any);
    // The read of the connections, which keeps the destinations of other tenants out, finds it.
    prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "cfg-1" }] as any);
  });

  it("returns correct KPI stats aggregated from parallel queries", async () => {
    prismaMock.job.count
      .mockResolvedValueOnce(10)  // totalJobs
      .mockResolvedValueOnce(3);  // activeSchedules
    prismaMock.execution.count
      .mockResolvedValueOnce(5)   // success24h
      .mockResolvedValueOnce(2)   // failed24h
      .mockResolvedValueOnce(20)  // total30d
      .mockResolvedValueOnce(15); // success30d

    const result = await getDashboardStats();

    expect(result.totalJobs).toBe(10);
    expect(result.activeSchedules).toBe(3);
    expect(result.success24h).toBe(5);
    expect(result.failed24h).toBe(2);
    expect(result.successRate30d).toBe(75); // 15/20 = 75%
    expect(result.totalSnapshots).toBe(4);
    expect(result.totalStorageBytes).toBe(2048);
  });

  it("counts a partial run against the success rate, like every success share of the dashboard", async () => {
    prismaMock.job.count.mockResolvedValue(0);
    prismaMock.execution.count.mockResolvedValue(0);

    await getDashboardStats();

    expect(prismaMock.execution.count).toHaveBeenCalledWith({
      where: { startedAt: { gte: expect.any(Date) }, status: { in: ["Success", "Partial", "Failed"] } },
    });
  });

  it("returns 100% success rate when no executions exist in the last 30 days", async () => {
    prismaMock.job.count.mockResolvedValue(0);
    prismaMock.execution.count
      .mockResolvedValueOnce(0)  // success24h
      .mockResolvedValueOnce(0)  // failed24h
      .mockResolvedValueOnce(0)  // total30d = 0
      .mockResolvedValueOnce(0); // success30d

    const result = await getDashboardStats();

    expect(result.successRate30d).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getActivityData
// ---------------------------------------------------------------------------

describe("getActivityData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns one entry per requested day", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getActivityData(7);

    expect(result).toHaveLength(7);
    expect(result[0]).toMatchObject({ completed: 0, failed: 0, running: 0, pending: 0, cancelled: 0 });
  });

  it("counts executions per status for each day", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      { status: "Success",   startedAt: new Date("2026-01-15T10:00:00Z") },
      { status: "Failed",    startedAt: new Date("2026-01-15T11:00:00Z") },
      { status: "Running",   startedAt: new Date("2026-01-15T11:30:00Z") },
      { status: "Pending",   startedAt: new Date("2026-01-14T10:00:00Z") },
      { status: "Cancelled", startedAt: new Date("2026-01-14T11:00:00Z") },
    ] as any);

    const result = await getActivityData(7);

    const today = result.find((r) => r.date === "Jan 15");
    expect(today?.completed).toBe(1);
    expect(today?.failed).toBe(1);
    expect(today?.running).toBe(1);

    const yesterday = result.find((r) => r.date === "Jan 14");
    expect(yesterday?.pending).toBe(1);
    expect(yesterday?.cancelled).toBe(1);
  });

  it("ignores executions that fall outside the initialized date range", async () => {
    // Prisma returns a record outside the 7-day window (dateMap has no entry for it)
    prismaMock.execution.findMany.mockResolvedValue([
      { status: "Success", startedAt: new Date("2025-12-01T10:00:00Z") },
    ] as any);

    const result = await getActivityData(7);

    const total = result.reduce((sum, r) => sum + r.completed, 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getStorageVolumeCacheAge
// ---------------------------------------------------------------------------

describe("getStorageVolumeCacheAge", () => {
  it("returns null when no cache-age setting exists", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);

    expect(await getStorageVolumeCacheAge()).toBeNull();
  });

  it("returns the stored timestamp string when the setting exists", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      value: "2026-05-01T10:00:00.000Z",
    } as any);

    expect(await getStorageVolumeCacheAge()).toBe("2026-05-01T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// getStorageVolume
// ---------------------------------------------------------------------------

describe("getStorageVolume", () => {
  it("returns parsed cached data when a valid cache entry exists", async () => {
    const cached = [{ configId: "cfg-1", name: "S3", adapterId: "s3", size: 500, count: 3 }];
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "cache.storageVolume",
      value: JSON.stringify(cached),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "cfg-1" }] as any);

    expect(await getStorageVolume()).toEqual(cached);
  });

  it("leaves out the destinations of another tenant, which the read of the connections does not return", async () => {
    // The cache holds the destinations of every tenant, the read of the connections only the viewer's.
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "cache.storageVolume",
      value: JSON.stringify([
        { configId: "own-s3", name: "S3", adapterId: "s3", size: 500, count: 3 },
        { configId: "other-nas", name: "NAS of another tenant", adapterId: "local", size: 9000, count: 40 },
      ]),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "own-s3" }] as any);

    const result = await getStorageVolume();

    expect(result).toEqual([{ configId: "own-s3", name: "S3", adapterId: "s3", size: 500, count: 3 }]);
    expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["own-s3", "other-nas"] } },
    }));
  });

  describe("of a destination the MSP shares with its customers", () => {
    const cache = [
      { configId: "acme-nas", tenantId: "acme", name: "NAS", adapterId: "local", size: 500, count: 3 },
      { configId: "msp-s3", tenantId: "msp", name: "MSP S3", adapterId: "s3", size: 50, count: 1 },
      { configId: "msp-s3", tenantId: "acme", name: "MSP S3", adapterId: "s3", size: 100, count: 2 },
      { configId: "msp-s3", tenantId: "shop", name: "MSP S3", adapterId: "s3", size: 200, count: 4 },
      { configId: "shop-ftp", tenantId: "shop", name: "FTP", adapterId: "ftp", size: 900, count: 9 },
    ];

    beforeEach(() => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({ key: "cache.storageVolume", value: JSON.stringify(cache) } as any);
    });

    it("shows a customer its own backups on it beside its own destinations, and nothing of the others", async () => {
      // The read of the connections in the tenant finds its own destination only.
      prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "acme-nas", tenantId: "acme" }] as any);
      vi.mocked(providedIds).mockResolvedValue(new Set(["msp-s3"]));

      const result = await runAsTenant("acme", () => getStorageVolume());

      expect(result).toEqual([cache[0], cache[2]]);
      expect(providedIds).toHaveBeenCalledWith("acme", ["msp-s3", "shop-ftp"]);
    });

    it("shows the MSP only its own backups on it, never the ones of its customers", async () => {
      prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "msp-s3", tenantId: "msp" }] as any);
      vi.mocked(providedIds).mockResolvedValue(new Set());

      const result = await runAsTenant("msp", () => getStorageVolume());

      expect(result).toEqual([cache[1]]);
    });

    it("shows each destination once outside a tenant, with the backups of every tenant on it, named for the tenant of the destination", async () => {
      prismaMock.adapterConfig.findMany.mockResolvedValue([
        { id: "acme-nas", tenantId: "acme" },
        { id: "msp-s3", tenantId: "msp" },
        { id: "shop-ftp", tenantId: "shop" },
      ] as any);

      const result = await getStorageVolume();

      // All tenants names the tenant of each, so two destinations of the same name stay apart.
      expect(result.map((entry) => [entry.configId, entry.tenantId, entry.size, entry.count])).toEqual([
        ["acme-nas", "acme", 500, 3],
        ["msp-s3", "msp", 350, 7],
        ["shop-ftp", "shop", 900, 9],
      ]);
      expect(providedIds).not.toHaveBeenCalled();
    });
  });

  it("triggers a live refresh when no cache entry exists", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockResolvedValue([]);

    const result = await getStorageVolume();

    expect(result).toEqual([]);
  });

  it("falls back to the last scanned values when the live refresh throws", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany
      .mockRejectedValueOnce(new Error("Adapter query failed")) // refreshStorageStatsCache throws
      .mockResolvedValueOnce([]); // the fallback finds no destinations

    const result = await getStorageVolume();

    expect(result).toEqual([]);
  });

  it("takes each destination's values from its newest snapshot when the refresh fails", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany
      .mockRejectedValueOnce(new Error("Refresh failed")) // triggers fallback
      .mockResolvedValue([ // the fallback, then the read of what the scope sees
        { id: "cfg-1", name: "Local", adapterId: "local", type: "storage" } as any,
      ]);
    prismaMock.storageSnapshot.findMany.mockResolvedValue([]);
    prismaMock.storageSnapshot.findFirst.mockResolvedValue({
      size: BigInt(3072),
      count: 2,
      createdAt: new Date("2026-09-21T08:00:00.000Z"),
    } as any);

    const result = await getStorageVolume();

    expect(result).toEqual([{
      configId: "cfg-1",
      name: "Local",
      adapterId: "local",
      size: 3072,
      count: 2,
      scanError: true,
      lastScanAt: "2026-09-21T08:00:00.000Z",
    }]);
    // The run history counts backups that retention deleted, so it is no longer used.
    expect(prismaMock.execution.findMany).not.toHaveBeenCalled();
  });

  it("falls through to a live refresh when cached JSON is corrupted", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "cache.storageVolume",
      value: "{ INVALID_JSON",
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockResolvedValue([]);

    const result = await getStorageVolume();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refreshStorageStatsCache
// ---------------------------------------------------------------------------

describe("refreshStorageStatsCache", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.storageSnapshot.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.systemSetting.findUnique.mockResolvedValue(null); // default retention setting
    // No destination is shared with customers, and none was measured for a customer before.
    prismaMock.connectionShare.findMany.mockResolvedValue([]);
    prismaMock.storageSnapshot.findMany.mockResolvedValue([]);
  });

  it("saves empty cache and returns [] when no storage adapters are configured", async () => {
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);

    const result = await refreshStorageStatsCache();

    expect(result).toEqual([]);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("queries adapter.list() and filters out .meta.json sidecar files", async () => {
    const mockAdapter = {
      list: vi.fn().mockResolvedValue([
        { name: "backup.sql", path: "backup.sql", size: 1000, lastModified: new Date() },
        { name: "backup.sql.meta.json", path: "backup.sql.meta.json", size: 50, lastModified: new Date() },
        { name: "backup2.sql", path: "backup2.sql", size: 2000, lastModified: new Date() },
      ]),
    };
    vi.mocked(registry.get).mockReturnValue(mockAdapter as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: HOME_TENANT_ID } as any,
    ]);

    const result = await refreshStorageStatsCache();

    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(3000);  // 1000 + 2000, meta excluded
    expect(result[0].count).toBe(2);    // 2 backup files
  });

  it("keeps the last scanned values of a destination whose listing fails", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockRejectedValue(new Error("S3 unreachable")),
    } as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: HOME_TENANT_ID } as any,
    ]);
    prismaMock.storageSnapshot.findFirst.mockResolvedValue({
      size: BigInt(800),
      count: 2,
      createdAt: new Date("2026-09-21T05:00:00.000Z"),
    } as any);

    const result = await refreshStorageStatsCache();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ size: 800, count: 2, scanError: true, lastScanAt: "2026-09-21T05:00:00.000Z" });
  });

  it("keeps the last scan of an air-gapped destination that is not connected without listing it", async () => {
    const list = vi.fn();
    vi.mocked(registry.get).mockReturnValue({ list } as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      {
        id: "usb", name: "USB rotation", adapterId: "local-filesystem", type: "storage", storageRole: "DESTINATION",
        config: "{}", lastStatus: "OFFLINE", metadata: JSON.stringify({ airGapped: true }), tenantId: HOME_TENANT_ID,
      } as any,
    ]);
    prismaMock.storageSnapshot.findFirst.mockResolvedValue({
      size: BigInt(4096),
      count: 4,
      createdAt: new Date("2026-09-27T05:00:00.000Z"),
    } as any);

    const result = await refreshStorageStatsCache();

    expect(list).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ configId: "usb", size: 4096, count: 4, scanError: true, lastScanAt: "2026-09-27T05:00:00.000Z" });
  });

  it("saves storage snapshots and checks alerts after a successful refresh", async () => {
    const mockAdapter = {
      list: vi.fn().mockResolvedValue([
        { name: "backup.sql", path: "backup.sql", size: 500, lastModified: new Date() },
      ]),
    };
    vi.mocked(registry.get).mockReturnValue(mockAdapter as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-snap", name: "Snap", adapterId: "local", type: "storage", config: "{}", tenantId: HOME_TENANT_ID } as any,
    ]);

    const { checkStorageAlerts } = await import("@/services/storage/storage-alert-service");

    const result = await refreshStorageStatsCache();

    expect(result[0].configId).toBe("cfg-snap");
    expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalled();
    expect(vi.mocked(checkStorageAlerts)).toHaveBeenCalledWith(result);
  });

  it("measures the destinations of every tenant, also when a run of one tenant asks for it", async () => {
    let scope: TenantScope | undefined;
    prismaMock.adapterConfig.findMany.mockImplementation((async () => {
      scope ??= explicitScope();
      return [];
    }) as any);

    await runAsTenant("acme", () => refreshStorageStatsCache());

    expect(scope).toEqual({ kind: "system" });
  });

  it("stamps each snapshot with the tenant of its destination", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([{ name: "backup.tar", path: "backup.tar", size: 100, lastModified: new Date() }]),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "home-s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: HOME_TENANT_ID },
      { id: "acme-nas", name: "NAS", adapterId: "local", type: "storage", config: "{}", tenantId: "acme" },
    ] as any);

    await refreshStorageStatsCache();

    expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ adapterConfigId: "home-s3", tenantId: HOME_TENANT_ID }),
        expect.objectContaining({ adapterConfigId: "acme-nas", tenantId: "acme" }),
      ],
    });
  });

  it("counts the backups under the tenants folder of each customer on a shared destination for that customer, and gives its alerts the whole destination", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([
        { name: "own.tar", path: "nightly/own.tar", size: 50, lastModified: new Date() },
        { name: "a.tar", path: "tenants/acme/nightly/a.tar", size: 100, lastModified: new Date() },
        { name: "a2.tar", path: "/tenants/acme/weekly/a2.tar", size: 120, lastModified: new Date() },
        { name: "s.tar", path: "tenants/shop/nightly/s.tar", size: 200, lastModified: new Date() },
      ]),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "msp-s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: "msp" },
    ] as any);
    prismaMock.connectionShare.findMany.mockResolvedValue([{ id: "msp-s3" }] as any);
    // Both are customers of the destination now.
    prismaMock.tenant.findMany.mockResolvedValue([{ id: "acme" }, { id: "shop" }] as any);
    vi.mocked(providedIds).mockResolvedValue(new Set(["msp-s3"]));
    const { checkStorageAlerts } = await import("@/services/storage/storage-alert-service");

    const result = await refreshStorageStatsCache();

    expect(result.map((entry) => [entry.tenantId, entry.size, entry.count])).toEqual([["msp", 50, 1], ["acme", 220, 2], ["shop", 200, 1]]);
    expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ adapterConfigId: "msp-s3", tenantId: "msp", size: BigInt(50) }),
        expect.objectContaining({ adapterConfigId: "msp-s3", tenantId: "acme", size: BigInt(220) }),
        expect.objectContaining({ adapterConfigId: "msp-s3", tenantId: "shop", size: BigInt(200) }),
      ],
    });
    // One time for the whole refresh, so the snapshots of the tenants read back as one measurement.
    const { data } = vi.mocked(prismaMock.storageSnapshot.createMany).mock.calls[0][0] as { data: { createdAt: Date }[] };
    expect(new Set(data.map((row) => row.createdAt.getTime())).size).toBe(1);
    // The storage limit and the usage spike watch everything the destination holds, the missing
    // backup alert the backups of its own tenant, which the entry names.
    expect(vi.mocked(checkStorageAlerts)).toHaveBeenCalledWith([{ configId: "msp-s3", tenantId: "msp", name: "S3", adapterId: "s3", size: 470, count: 4 }]);
  });

  it("counts the folder of a deleted tenant or one that lost the destination for nobody", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([
        { name: "own.tar", path: "nightly/own.tar", size: 50, lastModified: new Date() },
        { name: "a.tar", path: "tenants/acme/nightly/a.tar", size: 100, lastModified: new Date() },
        // Waits to be deleted after its tenant was.
        { name: "g.tar", path: "tenants/gone/nightly/g.tar", size: 700, lastModified: new Date() },
        { name: "l.tar", path: "tenants/lost/nightly/l.tar", size: 900, lastModified: new Date() },
      ]),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "msp-s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: "msp" },
    ] as any);
    prismaMock.connectionShare.findMany.mockResolvedValue([{ id: "msp-s3" }] as any);
    prismaMock.tenant.findMany.mockResolvedValue([{ id: "acme" }, { id: "lost" }] as any);
    vi.mocked(providedIds).mockImplementation(async (tenantId: string) => new Set(tenantId === "acme" ? ["msp-s3"] : []));

    const result = await refreshStorageStatsCache();

    expect(result.map((entry) => [entry.tenantId, entry.size, entry.count])).toEqual([["msp", 50, 1], ["acme", 100, 1]]);
    expect(prismaMock.tenant.findMany).toHaveBeenCalledWith({ where: { id: { in: ["acme", "gone", "lost"] } }, select: { id: true } });
  });

  it("counts a tenants folder on a destination nobody shares for the tenant of the destination", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([{ name: "a.tar", path: "tenants/acme/nightly/a.tar", size: 100, lastModified: new Date() }]),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "msp-s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: "msp" },
    ] as any);

    const result = await refreshStorageStatsCache();

    expect(result).toEqual([expect.objectContaining({ configId: "msp-s3", tenantId: "msp", size: 100, count: 1 })]);
  });

  it("keeps the last scan of every tenant measured on a shared destination whose listing fails", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockRejectedValue(new Error("S3 unreachable")),
    } as any);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "msp-s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: "msp" },
    ] as any);
    prismaMock.connectionShare.findMany.mockResolvedValue([{ id: "msp-s3" }] as any);
    prismaMock.storageSnapshot.findMany.mockResolvedValue([{ tenantId: "acme" }] as any);
    prismaMock.storageSnapshot.findFirst.mockImplementation((async (args: { where: { tenantId: string } }) => ({
      size: BigInt(args.where.tenantId === "acme" ? 700 : 300),
      count: 1,
      createdAt: new Date("2026-09-21T05:00:00.000Z"),
    })) as any);

    const result = await refreshStorageStatsCache();

    expect(result.map((entry) => [entry.tenantId, entry.size, entry.scanError])).toEqual([["msp", 300, true], ["acme", 700, true]]);
    expect(prismaMock.storageSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { adapterConfigId: "msp-s3", tenantId: "acme" } }));
  });

  describe("of the destinations a backup wrote to", () => {
    const destinations = [
      { id: "s3", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: HOME_TENANT_ID },
      { id: "nas", name: "NAS", adapterId: "local", type: "storage", config: "{}", tenantId: HOME_TENANT_ID },
      { id: "ftp", name: "FTP", adapterId: "ftp", type: "storage", config: "{}", tenantId: HOME_TENANT_ID },
    ];
    let stored: string | null;

    beforeEach(() => {
      stored = JSON.stringify([
        { configId: "s3", name: "S3", adapterId: "s3", size: 100, count: 1 },
        { configId: "nas", name: "NAS", adapterId: "local", size: 200, count: 2 },
        { configId: "ftp", name: "FTP", adapterId: "ftp", size: 300, count: 3 },
      ]);
      prismaMock.adapterConfig.findMany.mockResolvedValue(destinations as any);
      prismaMock.systemSetting.findUnique.mockImplementation((async (args: { where: { key: string } }) =>
        args.where.key === "cache.storageVolume" && stored !== null ? { key: args.where.key, value: stored } : null) as any);
      prismaMock.systemSetting.upsert.mockImplementation(((args: { where: { key: string }; update: { value: string } }) => {
        if (args.where.key === "cache.storageVolume") stored = args.update.value;
        return {} as any;
      }) as any);
    });

    const cachedSizes = () => Object.fromEntries((JSON.parse(stored!) as { configId: string; size: number }[]).map((entry) => [entry.configId, entry.size]));

    it("lists only those and keeps the cached values of every other destination", async () => {
      const list = vi.fn().mockResolvedValue([{ name: "backup.tar", path: "backup.tar", size: 150, lastModified: new Date() }]);
      vi.mocked(registry.get).mockReturnValue({ list } as any);
      const { checkStorageAlerts } = await import("@/services/storage/storage-alert-service");

      const result = await refreshStorageStatsCache({ configIds: ["nas"] });

      expect(list).toHaveBeenCalledTimes(1);
      expect(result.map((entry) => [entry.configId, entry.size])).toEqual([["s3", 100], ["nas", 150], ["ftp", 300]]);
      expect(cachedSizes()).toEqual({ s3: 100, nas: 150, ftp: 300 });
      // Snapshots and alerts only for what was measured now.
      expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ adapterConfigId: "nas", size: BigInt(150) })],
      });
      expect(vi.mocked(checkStorageAlerts)).toHaveBeenCalledWith([expect.objectContaining({ configId: "nas" })]);
    });

    it("clears the cached numbers of the tenants whose backups those hold, and keeps those of every other tenant", async () => {
      vi.mocked(registry.get).mockReturnValue({ list: vi.fn().mockResolvedValue([]) } as any);
      const { cached } = await import("@/services/dashboard/cache");
      const fill = (tenantId: string) => runAsTenant(tenantId, () => cached("storage-card", 60_000, async () => `${tenantId} before`));
      await fill(HOME_TENANT_ID);
      await fill("acme");

      await refreshStorageStatsCache({ configIds: ["nas"] });

      const read = (tenantId: string) => runAsTenant(tenantId, () => cached("storage-card", 60_000, async () => `${tenantId} after`));
      expect(await read(HOME_TENANT_ID)).toBe(`${HOME_TENANT_ID} after`);
      expect(await read("acme")).toBe("acme before");
    });

    it("also lists a destination the cache does not hold yet", async () => {
      stored = JSON.stringify([{ configId: "s3", name: "S3", adapterId: "s3", size: 100, count: 1 }]);
      const list = vi.fn().mockResolvedValue([]);
      vi.mocked(registry.get).mockReturnValue({ list } as any);

      const result = await refreshStorageStatsCache({ configIds: ["nas"] });

      expect(list).toHaveBeenCalledTimes(2); // nas and the new ftp, not s3
      expect(result.map((entry) => entry.configId)).toEqual(["s3", "nas", "ftp"]);
    });

    it("keeps the values of both when two backups end at the same time", async () => {
      // The listing of s3 is slow, the one of the NAS answers right away.
      vi.mocked(registry.get).mockImplementation(((adapterId: string) => ({
        list: () => new Promise((resolve) => setTimeout(
          () => resolve([{ name: "backup.tar", path: "backup.tar", size: adapterId === "s3" ? 111 : 222, lastModified: new Date() }]),
          adapterId === "s3" ? 30 : 0,
        )),
      })) as any);

      await Promise.all([
        refreshStorageStatsCache({ configIds: ["s3"] }),
        refreshStorageStatsCache({ configIds: ["nas"] }),
      ]);

      expect(cachedSizes()).toEqual({ s3: 111, nas: 222, ftp: 300 });
    });
  });

  it("returns null entry (skipped) when registry.get returns undefined", async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}", tenantId: HOME_TENANT_ID } as any,
    ]);

    const result = await refreshStorageStatsCache();

    // Adapter not found → promise resolves null → filtered out
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getLatestJobs
// ---------------------------------------------------------------------------

describe("getLatestJobs", () => {
  it("returns formatted entries with correct duration", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-1",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: new Date("2026-01-01T10:05:00Z"),
        metadata: null,
        jobId: "job-1",
        job: { name: "My Job", source: { name: "MySQL DB", type: "mysql" }, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(7);

    expect(result).toHaveLength(1);
    expect(result[0].jobName).toBe("My Job");
    expect(result[0].sourceName).toBe("MySQL DB");
    expect(result[0].sourceType).toBe("mysql");
    expect(result[0].duration).toBe(5 * 60 * 1000);
  });

  it("names a backup like the History page, with the databases it held, and keeps the source of its metadata", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-2",
        type: "Backup",
        status: "Failed",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: null,
        metadata: JSON.stringify({
          jobName: "Meta Job",
          sourceName: "PG Primary",
          sourceType: "postgres",
          names: ["db1", "db2"],
        }),
        jobId: "job-2",
        job: { name: "Old Name", source: null, sources: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0].jobName).toBe("Old Name");
    expect(result[0].sub).toBe("Backup · db1, db2");
    expect(result[0].sourceName).toBe("PG Primary");
    expect(result[0].sourceType).toBe("postgres");
    expect(result[0].duration).toBe(0); // no endedAt
  });

  it("names the backup of a deleted job like the History page", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-3",
        type: "Backup",
        status: "Running",
        startedAt: new Date(),
        endedAt: null,
        metadata: null,
        jobId: "deleted-job-id",
        job: null,
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0].jobName).toBe("A deleted job");
  });

  it("names a restore without a job like the History page, never as a manual action", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-4",
        type: "Restore",
        status: "Success",
        startedAt: new Date(),
        endedAt: null,
        metadata: null,
        jobId: null,
        job: null,
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0]).toEqual(expect.objectContaining({ jobName: "Restore", sub: "Restore" }));
  });

  it("does not crash on invalid metadata JSON", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-5",
        type: "Backup",
        status: "Success",
        startedAt: new Date(),
        endedAt: null,
        metadata: "{ INVALID",
        jobId: "job-5",
        job: { name: "Job 5", source: null, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0].jobName).toBe("Job 5");
  });
});

// ---------------------------------------------------------------------------
// hasRunningJobs
// ---------------------------------------------------------------------------

describe("hasRunningJobs", () => {
  it("returns true when running or pending jobs exist", async () => {
    prismaMock.execution.count.mockResolvedValue(2);

    expect(await hasRunningJobs()).toBe(true);
  });

  it("returns false when no running or pending jobs exist", async () => {
    prismaMock.execution.count.mockResolvedValue(0);

    expect(await hasRunningJobs()).toBe(false);
  });
});
