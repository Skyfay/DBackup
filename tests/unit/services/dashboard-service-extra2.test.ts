/**
 * Extra coverage for dashboard-service.ts targeting:
 *   - Line 476: refreshStorageStatsCache - when saveStorageSnapshots throws (outer catch)
 *   - Lines 654-657: checkStorageAlerts throwing is caught and logged as warning, not re-thrown
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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

const mockCheckStorageAlerts = vi.fn();
vi.mock("@/services/storage/storage-alert-service", () => ({
  checkStorageAlerts: (...args: any[]) => mockCheckStorageAlerts(...args),
}));

import { refreshStorageStatsCache } from "@/services/dashboard-service";
import { registry } from "@/lib/core/registry";

// ---------------------------------------------------------------------------
// Helper to set up a minimal prismaMock for refreshStorageStatsCache
// ---------------------------------------------------------------------------

function setupStorageAdapter() {
  const mockStorageAdapter = {
    list: vi.fn().mockResolvedValue([]),
    ping: vi.fn().mockResolvedValue({ success: true }),
  };
  vi.mocked(registry.get).mockReturnValue(mockStorageAdapter as any);
  return mockStorageAdapter;
}

function setupPrismaMocks() {
  // No adapters to scan.
  prismaMock.adapterConfig.findMany.mockResolvedValue([]);

  // saveStorageCache upserts.
  prismaMock.$transaction.mockResolvedValue([]);

  // cleanupOldSnapshots query.
  prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 });

  // snapshotRetentionDays setting.
  prismaMock.systemSetting.findUnique.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Lines 654-657: checkStorageAlerts throwing is swallowed as a warning
// ---------------------------------------------------------------------------

describe("refreshStorageStatsCache - checkStorageAlerts error is swallowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPrismaMocks();
    setupStorageAdapter();

    // Provide a valid adapter so saveStorageSnapshots gets called with entries
    // that have a configId and no scanError.
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      {
        id: "cfg-1",
        name: "Local",
        adapterId: "local",
        type: "storage",
        config: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    // list returns files so we get a non-empty entry with configId set.
    // The path field is required - the service filters on f.path.replace(...).
    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([
        { name: "backup.sql", path: "backup.sql", size: 1024 },
      ]),
      ping: vi.fn().mockResolvedValue({ success: true }),
    } as any);

    // storageSnapshot.createMany succeeds.
    prismaMock.storageSnapshot.createMany.mockResolvedValue({ count: 1 });

    // Fallback execution query (used when list() throws).
    prismaMock.execution.findMany.mockResolvedValue([]);
  });

  it("does not throw when checkStorageAlerts rejects", async () => {
    mockCheckStorageAlerts.mockRejectedValue(new Error("Alert system down"));

    // Should resolve without throwing even though checkStorageAlerts fails.
    await expect(refreshStorageStatsCache()).resolves.toBeDefined();
  });

  it("still returns results even after checkStorageAlerts fails", async () => {
    mockCheckStorageAlerts.mockRejectedValue(new Error("Alert system down"));

    const results = await refreshStorageStatsCache();

    // Results array is returned normally.
    expect(Array.isArray(results)).toBe(true);
  });

  it("calls checkStorageAlerts with entries that have configId and no scanError", async () => {
    mockCheckStorageAlerts.mockResolvedValue(undefined);

    await refreshStorageStatsCache();

    expect(mockCheckStorageAlerts).toHaveBeenCalledTimes(1);
    const [entries] = mockCheckStorageAlerts.mock.calls[0];
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry.configId).toBeDefined();
      expect(entry.scanError).toBeFalsy();
    }
  });
});

// ---------------------------------------------------------------------------
// saveStorageSnapshots outer catch: createMany throws -> warn but no re-throw
// ---------------------------------------------------------------------------

describe("refreshStorageStatsCache - saveStorageSnapshots outer error is swallowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPrismaMocks();
    setupStorageAdapter();

    // Provide a valid adapter so saveStorageSnapshots is called.
    prismaMock.adapterConfig.findMany.mockResolvedValue([
      {
        id: "cfg-2",
        name: "S3",
        adapterId: "s3",
        type: "storage",
        config: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    vi.mocked(registry.get).mockReturnValue({
      list: vi.fn().mockResolvedValue([{ name: "backup.sql", path: "backup.sql", size: 512 }]),
      ping: vi.fn().mockResolvedValue({ success: true }),
    } as any);

    // Fallback execution query (used when list() throws).
    prismaMock.execution.findMany.mockResolvedValue([]);

    // Force createMany to throw so the outer catch in saveStorageSnapshots fires.
    prismaMock.storageSnapshot.createMany.mockRejectedValue(
      new Error("DB write error")
    );
  });

  it("does not throw when storageSnapshot.createMany rejects", async () => {
    await expect(refreshStorageStatsCache()).resolves.toBeDefined();
  });

  it("still returns the scanned storage results when snapshot persistence fails", async () => {
    const results = await refreshStorageStatsCache();

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("does not call checkStorageAlerts when createMany throws before it", async () => {
    await refreshStorageStatsCache();

    // checkStorageAlerts is inside the try block after createMany - it should
    // not have been reached when createMany threw.
    expect(mockCheckStorageAlerts).not.toHaveBeenCalled();
  });
});
