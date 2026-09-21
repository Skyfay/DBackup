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

    expect(await getStorageVolume()).toEqual(cached);
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
      .mockResolvedValueOnce([
        { id: "cfg-1", name: "Local", adapterId: "local", type: "storage" } as any,
      ]);
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
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}" } as any,
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
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}" } as any,
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

  it("saves storage snapshots and checks alerts after a successful refresh", async () => {
    const mockAdapter = {
      list: vi.fn().mockResolvedValue([
        { name: "backup.sql", path: "backup.sql", size: 500, lastModified: new Date() },
      ]),
    };
    vi.mocked(registry.get).mockReturnValue(mockAdapter as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-snap", name: "Snap", adapterId: "local", type: "storage", config: "{}" } as any,
    ]);

    const { checkStorageAlerts } = await import("@/services/storage/storage-alert-service");

    const result = await refreshStorageStatsCache();

    expect(result[0].configId).toBe("cfg-snap");
    expect(prismaMock.storageSnapshot.createMany).toHaveBeenCalled();
    expect(vi.mocked(checkStorageAlerts)).toHaveBeenCalledWith(result);
  });

  it("returns null entry (skipped) when registry.get returns undefined", async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-1", name: "S3", adapterId: "s3", type: "storage", config: "{}" } as any,
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

  it("overrides fields from metadata when available", async () => {
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
          databases: ["db1", "db2"],
        }),
        jobId: "job-2",
        job: { name: "Old Name", source: null, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0].jobName).toBe("Meta Job");
    expect(result[0].sourceName).toBe("PG Primary");
    expect(result[0].sourceType).toBe("postgres");
    expect(result[0].databaseName).toBe("db1, db2");
    expect(result[0].duration).toBe(0); // no endedAt
  });

  it("uses 'Deleted Job' when job relation is null but jobId is set", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-3",
        type: "Restore",
        status: "Running",
        startedAt: new Date(),
        endedAt: null,
        metadata: null,
        jobId: "deleted-job-id",
        job: null,
      },
    ] as any);

    const result = await getLatestJobs(1);

    expect(result[0].jobName).toBe("Deleted Job");
  });

  it("uses 'Manual Action' when both job and jobId are null", async () => {
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

    expect(result[0].jobName).toBe("Manual Action");
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
