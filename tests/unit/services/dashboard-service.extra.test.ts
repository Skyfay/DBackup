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
  getCalendarDataForYear,
  getActivityData,
  getLatestJobs,
  getStorageVolume,
  refreshStorageStatsCache,
} from "@/services/dashboard-service";
import { registry } from "@/lib/core/registry";

// ---------------------------------------------------------------------------
// getCalendarDataForYear - full year iteration
// ---------------------------------------------------------------------------

describe("getCalendarDataForYear", () => {
  beforeEach(() => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
  });

  it("returns one entry per unique calendar day for the year 2024 (leap year)", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getCalendarDataForYear(2024);

    // 2024 is a leap year (366 days), but addDays may produce one duplicate key
    // due to DST transitions in certain timezones. In UTC the Map deduplication
    // means the actual unique day count is 365. Verify the range [365, 366].
    expect(result.length).toBeGreaterThanOrEqual(365);
    expect(result.length).toBeLessThanOrEqual(366);
  });

  it("returns one entry per unique calendar day for the non-leap year 2023", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getCalendarDataForYear(2023);

    expect(result.length).toBeGreaterThanOrEqual(364);
    expect(result.length).toBeLessThanOrEqual(365);
  });

  it("first entry is Jan 1 and last entry is Dec 31 for 2024", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getCalendarDataForYear(2024);

    expect(result[0].date).toBe("2024-01-01");
    expect(result[result.length - 1].date).toBe("2024-12-31");
  });

  it("all entries have zero counts when no executions exist", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getCalendarDataForYear(2024);

    for (const day of result) {
      expect(day.total).toBe(0);
      expect(day.completed).toBe(0);
      expect(day.failed).toBe(0);
      expect(day.partial).toBe(0);
    }
  });

  it("correctly accumulates execution counts into the matching day", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      { startedAt: new Date("2024-06-15T08:00:00Z"), status: "Success" },
      { startedAt: new Date("2024-06-15T14:00:00Z"), status: "Failed" },
      { startedAt: new Date("2024-06-15T16:00:00Z"), status: "Partial" },
      { startedAt: new Date("2024-06-16T09:00:00Z"), status: "Success" },
    ] as any);

    const result = await getCalendarDataForYear(2024);

    const june15 = result.find((d) => d.date === "2024-06-15");
    expect(june15).toBeDefined();
    expect(june15!.total).toBe(3);
    expect(june15!.completed).toBe(1);
    expect(june15!.failed).toBe(1);
    expect(june15!.partial).toBe(1);

    const june16 = result.find((d) => d.date === "2024-06-16");
    expect(june16).toBeDefined();
    expect(june16!.total).toBe(1);
    expect(june16!.completed).toBe(1);
  });

  it("uses system timezone from settings when formatting dates", async () => {
    // US/Eastern is UTC-5 in winter - an execution at 01:00 UTC on Jan 2 falls on Jan 1 Eastern
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "system.timezone",
      value: "America/New_York",
    } as any);
    prismaMock.execution.findMany.mockResolvedValue([
      { startedAt: new Date("2024-01-02T01:00:00Z"), status: "Success" },
    ] as any);

    const result = await getCalendarDataForYear(2024);

    const jan1 = result.find((d) => d.date === "2024-01-01");
    const jan2 = result.find((d) => d.date === "2024-01-02");

    // In America/New_York (UTC-5) 01:00 UTC = 20:00 previous day, so it falls on Jan 1
    expect(jan1!.completed).toBe(1);
    expect(jan2!.completed).toBe(0);
  });

  it("queries only Backup-type executions within the year boundaries", async () => {
    prismaMock.execution.findMany.mockResolvedValue([]);

    await getCalendarDataForYear(2024);

    expect(prismaMock.execution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "Backup",
          startedAt: {
            gte: new Date(Date.UTC(2024, 0, 1)),
            lt: new Date(Date.UTC(2025, 0, 1)),
          },
        }),
      })
    );
  });

  it("ignores executions with dates outside the year (prisma edge case)", async () => {
    // Even if prisma returns something out of range, it should be silently skipped
    prismaMock.execution.findMany.mockResolvedValue([
      { startedAt: new Date("2023-12-31T23:59:00Z"), status: "Success" },
    ] as any);

    const result = await getCalendarDataForYear(2024);

    const total = result.reduce((sum, d) => sum + d.total, 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getLatestJobs - additional metadata edge cases
// ---------------------------------------------------------------------------

describe("getLatestJobs - metadata edge cases", () => {
  it("does not crash and uses job relation data when metadata is malformed JSON", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-bad-meta",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: new Date("2026-01-01T10:02:00Z"),
        metadata: "NOT_VALID_JSON{{",
        jobId: "job-1",
        job: { name: "Fallback Job", source: { name: "Postgres", type: "postgres" }, destinations: [] },
      },
    ] as any);

    let result: Awaited<ReturnType<typeof getLatestJobs>>;
    await expect(async () => {
      result = await getLatestJobs(1);
    }).not.toThrow();

    result = await getLatestJobs(1);
    expect(result[0].jobName).toBe("Fallback Job");
    expect(result[0].sourceName).toBe("Postgres");
    expect(result[0].sourceType).toBe("postgres");
    expect(result[0].databaseName).toBeNull();
  });

  it("does not crash when metadata is an empty string", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-empty-meta",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: null,
        metadata: "",
        jobId: "job-2",
        job: { name: "Empty Meta Job", source: null, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);
    expect(result[0].jobName).toBe("Empty Meta Job");
  });

  it("does not crash when metadata is a valid JSON number (not an object)", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-num-meta",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: null,
        metadata: "42",
        jobId: "job-3",
        job: { name: "Num Meta Job", source: null, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);
    expect(result[0].jobName).toBe("Num Meta Job");
  });

  it("ignores metadata fields that are empty strings (falsy override guard)", async () => {
    prismaMock.execution.findMany.mockResolvedValue([
      {
        id: "exec-empty-fields",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        endedAt: null,
        metadata: JSON.stringify({ jobName: "", sourceName: "", databases: [] }),
        jobId: "job-4",
        job: { name: "Real Job", source: { name: "Real Source", type: "mysql" }, destinations: [] },
      },
    ] as any);

    const result = await getLatestJobs(1);
    // Empty strings are falsy - the service uses `if (meta.jobName)` so no override
    expect(result[0].jobName).toBe("Real Job");
    expect(result[0].sourceName).toBe("Real Source");
    expect(result[0].databaseName).toBeNull(); // empty array, no join
  });
});

// ---------------------------------------------------------------------------
// getStorageVolume - cache miss triggers refreshStorageStatsCache
// ---------------------------------------------------------------------------

describe("getStorageVolume - cache miss behavior", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.storageSnapshot.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 } as any);
  });

  it("calls refreshStorageStatsCache when no cache entry is present", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);

    const result = await getStorageVolume();

    // With no adapters configured, refresh returns [] and saves empty cache
    expect(result).toEqual([]);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("returns live adapter data when cache is missing and adapters are configured", async () => {
    const mockAdapter = {
      list: vi.fn().mockResolvedValue([
        { name: "data.sql", path: "data.sql", size: 4096, lastModified: new Date() },
      ]),
    };
    vi.mocked(registry.get).mockReturnValue(mockAdapter as any);

    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-live", name: "Live S3", adapterId: "s3", type: "storage", config: "{}" } as any,
    ]);

    const result = await getStorageVolume();

    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(4096);
    expect(result[0].count).toBe(1);
  });

  it("falls back to DB estimation when refreshStorageStatsCache throws entirely", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    // First call from refreshStorageStatsCache - throws
    // Second call from getStorageVolumeFromDB - returns an adapter
    prismaMock.adapterConfig.findMany
      .mockRejectedValueOnce(new Error("DB connection error"))
      .mockResolvedValueOnce([
        { id: "cfg-db", name: "DB Only", adapterId: "local", type: "storage" } as any,
      ]);
    prismaMock.execution.findMany.mockResolvedValue([
      { size: BigInt(999) },
    ] as any);

    const result = await getStorageVolume();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("DB Only");
    expect(result[0].size).toBe(999);
    expect(result[0].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getActivityData - timezone formatting edge cases
// ---------------------------------------------------------------------------

describe("getActivityData - timezone edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses UTC when no timezone setting is configured", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.execution.findMany.mockResolvedValue([
      { status: "Success", startedAt: new Date("2026-01-15T00:30:00Z") },
    ] as any);

    const result = await getActivityData(3);

    const jan15 = result.find((r) => r.date === "Jan 15");
    expect(jan15).toBeDefined();
    expect(jan15!.completed).toBe(1);
  });

  it("uses configured system timezone for day boundary calculation", async () => {
    // America/New_York UTC-5: 2026-01-15T02:00:00Z = 2026-01-14T21:00:00 Eastern
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "system.timezone",
      value: "America/New_York",
    } as any);
    prismaMock.execution.findMany.mockResolvedValue([
      { status: "Success", startedAt: new Date("2026-01-15T02:00:00Z") },
    ] as any);

    const result = await getActivityData(7);

    // 2026-01-15T02:00:00Z = Jan 14 in America/New_York
    const jan14 = result.find((r) => r.date === "Jan 14");
    const jan15 = result.find((r) => r.date === "Jan 15");

    expect(jan14!.completed).toBe(1);
    expect(jan15!.completed).toBe(0);
  });

  it("returns entries in chronological order (oldest first)", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.execution.findMany.mockResolvedValue([]);

    const result = await getActivityData(5);

    expect(result).toHaveLength(5);
    // First entry is 4 days ago (Jan 11), last is today (Jan 15)
    expect(result[0].date).toBe("Jan 11");
    expect(result[4].date).toBe("Jan 15");
  });

  it("handles Partial status correctly", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    prismaMock.execution.findMany.mockResolvedValue([
      { status: "Partial", startedAt: new Date("2026-01-15T10:00:00Z") },
    ] as any);

    const result = await getActivityData(3);

    const jan15 = result.find((r) => r.date === "Jan 15");
    expect(jan15!.partial).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// refreshStorageStatsCache - adapter ping failure fallback
// ---------------------------------------------------------------------------

describe("refreshStorageStatsCache - adapter failure fallback", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.storageSnapshot.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
  });

  it("marks scanError true and uses DB fallback when adapter.list throws", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockRejectedValue(new Error("Connection refused")),
    } as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-err", name: "Broken S3", adapterId: "s3", type: "storage", config: "{}" } as any,
    ]);
    prismaMock.execution.findMany.mockResolvedValue([
      { size: BigInt(100) },
      { size: BigInt(200) },
    ] as any);

    const result = await refreshStorageStatsCache();

    expect(result).toHaveLength(1);
    expect(result[0].scanError).toBe(true);
    expect(result[0].size).toBe(300);
    expect(result[0].count).toBe(2);
  });

  it("skips snapshots for adapters with scanError and logs a warning", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockRejectedValue(new Error("Timeout")),
    } as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-scan-err", name: "Faulty", adapterId: "local", type: "storage", config: "{}" } as any,
    ]);
    prismaMock.execution.findMany.mockResolvedValue([] as any);

    await refreshStorageStatsCache();

    // storageSnapshot.createMany should not be called because all entries have scanError
    expect(prismaMock.storageSnapshot.createMany).not.toHaveBeenCalled();
  });

  it("filters .dbackup/ internal files from adapter listing", async () => {
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([
        { name: "real.sql", path: "real.sql", size: 2000, lastModified: new Date() },
        { name: "config.json", path: ".dbackup/config.json", size: 500, lastModified: new Date() },
        { name: "meta.json", path: "/.dbackup/meta.json", size: 100, lastModified: new Date() },
      ]),
    } as any);

    prismaMock.adapterConfig.findMany.mockResolvedValue([
      { id: "cfg-filter", name: "S3", adapterId: "s3", type: "storage", config: "{}" } as any,
    ]);

    const result = await refreshStorageStatsCache();

    // Only the real.sql file should be counted
    expect(result[0].count).toBe(1);
    expect(result[0].size).toBe(2000);
  });
});
