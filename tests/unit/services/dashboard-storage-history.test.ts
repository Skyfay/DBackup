import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { runAsTenant } from "@/lib/tenant/context";

// Mock logger to prevent output during tests
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

// Mock errors module
vi.mock("@/lib/logging/errors", () => ({
  wrapError: (e: unknown) => e,
}));

// Mock adapters registration
vi.mock("@/lib/adapters", () => ({
  registerAdapters: vi.fn(),
}));

// Mock crypto
vi.mock("@/lib/crypto", () => ({
  decryptConfig: (input: unknown) => input,
}));

import {
  getStorageHistory,
  cleanupOldSnapshots,
} from "@/services/dashboard-service";

describe("Storage History (dashboard-service)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getStorageHistory", () => {
    it("should return formatted snapshot entries for a given configId", async () => {
      const mockSnapshots = [
        {
          id: "snap-1",
          adapterConfigId: "config-123",
          adapterName: "Local",
          adapterId: "local",
          tenantId: HOME_TENANT_ID,
          size: BigInt(1024 * 1024 * 100), // 100 MB
          count: 5,
          createdAt: new Date("2026-02-10T10:00:00.000Z"),
        },
        {
          id: "snap-2",
          adapterConfigId: "config-123",
          adapterName: "Local",
          adapterId: "local",
          tenantId: HOME_TENANT_ID,
          size: BigInt(1024 * 1024 * 200), // 200 MB
          count: 8,
          createdAt: new Date("2026-02-12T10:00:00.000Z"),
        },
        {
          id: "snap-3",
          adapterConfigId: "config-123",
          adapterName: "Local",
          adapterId: "local",
          tenantId: HOME_TENANT_ID,
          size: BigInt(1024 * 1024 * 350), // 350 MB
          count: 12,
          createdAt: new Date("2026-02-14T10:00:00.000Z"),
        },
      ];

      prismaMock.storageSnapshot.findMany.mockResolvedValue(mockSnapshots);

      const result = await getStorageHistory("config-123", 30);

      // Verify Prisma was called with correct params
      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalledWith({
        where: {
          adapterConfigId: "config-123",
          createdAt: { gte: new Date("2026-01-16T12:00:00.000Z") },
        },
        orderBy: { createdAt: "asc" },
        select: {
          size: true,
          count: true,
          createdAt: true,
        },
      });

      // Verify result format
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        date: "2026-02-10T10:00:00.000Z",
        size: 1024 * 1024 * 100,
        count: 5,
      });
      expect(result[2]).toEqual({
        date: "2026-02-14T10:00:00.000Z",
        size: 1024 * 1024 * 350,
        count: 12,
      });
    });

    it("should return empty array when no snapshots exist", async () => {
      prismaMock.storageSnapshot.findMany.mockResolvedValue([]);

      const result = await getStorageHistory("config-empty", 7);

      expect(result).toEqual([]);
      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            adapterConfigId: "config-empty",
          }),
        })
      );
    });

    it("should use default 30 days when no days parameter is provided", async () => {
      prismaMock.storageSnapshot.findMany.mockResolvedValue([]);

      await getStorageHistory("config-123");

      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date("2026-01-16T12:00:00.000Z") },
          }),
        })
      );
    });

    it("should convert BigInt size to number in results", async () => {
      const largeSize = BigInt(5 * 1024 * 1024 * 1024); // 5 GB
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        {
          id: "snap-large",
          adapterConfigId: "config-large",
          adapterName: "Local",
          adapterId: "local",
          tenantId: HOME_TENANT_ID,
          size: largeSize,
          count: 50,
          createdAt: new Date("2026-02-14T12:00:00.000Z"),
        },
      ]);

      const result = await getStorageHistory("config-large");

      expect(typeof result[0].size).toBe("number");
      expect(result[0].size).toBe(5 * 1024 * 1024 * 1024);
    });
  });

  describe("of a destination its tenant shares with customers", () => {
    /** A snapshot as the history reads it, of the tenant named in the comment beside it. */
    const snapshot = (size: number, at: string) => ({ size: BigInt(size), count: 1, createdAt: new Date(at) });

    it("shows a tenant its own backups only", async () => {
      prismaMock.storageSnapshot.findMany.mockResolvedValue([snapshot(300, "2026-02-14T10:00:00.000Z")] as any);

      const result = await runAsTenant("acme", () => getStorageHistory("msp-s3", 30));

      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ adapterConfigId: "msp-s3", tenantId: "acme" }),
      }));
      expect(result).toEqual([{ date: "2026-02-14T10:00:00.000Z", size: 300, count: 1 }]);
    });

    it("shows All tenants one point per refresh with the backups of every tenant summed", async () => {
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        // One refresh writes the MSP and each customer at one time.
        snapshot(100, "2026-02-13T10:00:00.000Z"), // msp
        snapshot(300, "2026-02-13T10:00:00.000Z"), // acme
        snapshot(50, "2026-02-13T10:00:00.000Z"), // shop
        snapshot(120, "2026-02-14T10:00:00.000Z"), // msp
        snapshot(310, "2026-02-14T10:00:00.000Z"), // acme
        // A refresh a moment later, after a backup, is a point of its own.
        snapshot(130, "2026-02-14T10:00:20.000Z"), // msp
        snapshot(320, "2026-02-14T10:00:20.000Z"), // acme
      ] as any);

      const result = await getStorageHistory("msp-s3", 30);

      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { adapterConfigId: "msp-s3", createdAt: { gte: new Date("2026-01-16T12:00:00.000Z") } },
      }));
      expect(result).toEqual([
        { date: "2026-02-13T10:00:00.000Z", size: 450, count: 3 },
        { date: "2026-02-14T10:00:00.000Z", size: 430, count: 2 },
        { date: "2026-02-14T10:00:20.000Z", size: 450, count: 2 },
      ]);
    });
  });

  describe("cleanupOldSnapshots", () => {
    it("should delete snapshots older than retention period", async () => {
      prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 15 });

      const deleted = await cleanupOldSnapshots(90);

      expect(deleted).toBe(15);
      expect(prismaMock.storageSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: new Date("2025-11-17T12:00:00.000Z") }, // 90 days before 2026-02-15
        },
      });
    });

    it("should use 90 days as default retention period", async () => {
      prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 });

      await cleanupOldSnapshots();

      expect(prismaMock.storageSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: new Date("2025-11-17T12:00:00.000Z") },
        },
      });
    });

    it("should return 0 when no old snapshots exist", async () => {
      prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 0 });

      const deleted = await cleanupOldSnapshots(30);

      expect(deleted).toBe(0);
    });

    it("should accept custom retention days", async () => {
      prismaMock.storageSnapshot.deleteMany.mockResolvedValue({ count: 5 });

      const deleted = await cleanupOldSnapshots(7);

      expect(deleted).toBe(5);
      expect(prismaMock.storageSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: new Date("2026-02-08T12:00:00.000Z") }, // 7 days before 2026-02-15
        },
      });
    });
  });
});
