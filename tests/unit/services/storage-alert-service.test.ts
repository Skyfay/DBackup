import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

// ── Mocks ──────────────────────────────────────────────────────

const mockNotify = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/system-notification-service", () => ({
  notify: (...args: any[]) => mockNotify(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/errors", () => ({
  wrapError: vi.fn((e: any) => e),
}));

import {
  getAlertConfig,
  saveAlertConfig,
  checkStorageAlerts,
  defaultAlertConfig,
  defaultAlertStates,
  getAlertStates,
  saveAlertStates,
  ALERT_COOLDOWN_MS,
  type StorageAlertConfig,
  type StorageAlertStates,
} from "@/services/storage-alert-service";

// ── Helpers ────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<{
  configId: string;
  name: string;
  adapterId: string;
  size: number;
  count: number;
}>) {
  return {
    configId: "cfg-1",
    name: "Test Storage",
    adapterId: "local",
    size: 1073741824, // 1 GB
    count: 10,
    ...overrides,
  };
}

function makeAlertConfig(overrides?: Partial<StorageAlertConfig>): StorageAlertConfig {
  return { ...defaultAlertConfig(), ...overrides };
}

/**
 * Mock both alert config and state for a destination.
 * Uses mockImplementation to distinguish between config and state keys.
 */
function mockAlertSetting(
  configId: string,
  config: Partial<StorageAlertConfig>,
  state?: Partial<StorageAlertStates>
) {
  prismaMock.systemSetting.findUnique.mockImplementation((async (args: any) => {
    const key = args.where.key;
    if (key === `storage.alerts.${configId}`) {
      return {
        key,
        value: JSON.stringify({ ...defaultAlertConfig(), ...config }),
        description: null,
        updatedAt: new Date(),
      };
    }
    if (key === `storage.alerts.${configId}.state`) {
      if (state) {
        return {
          key,
          value: JSON.stringify({ ...defaultAlertStates(), ...state }),
          description: null,
          updatedAt: new Date(),
        };
      }
      return null; // default: no prior state
    }
    return null;
  }) as any);
}

// ── Tests ──────────────────────────────────────────────────────

describe("StorageAlertService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── defaultAlertConfig ─────────────────────────────────────

  describe("defaultAlertConfig", () => {
    it("should return all alerts disabled by default", () => {
      const config = defaultAlertConfig();
      expect(config.usageSpikeEnabled).toBe(false);
      expect(config.storageLimitEnabled).toBe(false);
      expect(config.missingBackupEnabled).toBe(false);
    });

    it("should have sensible default thresholds", () => {
      const config = defaultAlertConfig();
      expect(config.usageSpikeThresholdPercent).toBe(50);
      expect(config.storageLimitBytes).toBe(10 * 1024 * 1024 * 1024); // 10 GB
      expect(config.missingBackupHours).toBe(48);
    });
  });

  // ── defaultAlertStates ─────────────────────────────────────

  describe("defaultAlertStates", () => {
    it("should return all alerts inactive with no prior notifications", () => {
      const states = defaultAlertStates();
      expect(states.usageSpike).toEqual({ active: false, lastNotifiedAt: null });
      expect(states.storageLimit).toEqual({ active: false, lastNotifiedAt: null });
      expect(states.missingBackup).toEqual({ active: false, lastNotifiedAt: null });
    });
  });

  // ── getAlertConfig ─────────────────────────────────────────

  describe("getAlertConfig", () => {
    it("should return defaults when no setting exists", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue(null);

      const config = await getAlertConfig("cfg-1");

      expect(config).toEqual(defaultAlertConfig());
      expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { key: "storage.alerts.cfg-1" },
      });
    });

    it("should parse stored JSON config", async () => {
      const stored = makeAlertConfig({
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 25,
      });

      prismaMock.systemSetting.findUnique.mockResolvedValue({
        key: "storage.alerts.cfg-1",
        value: JSON.stringify(stored),
        description: null,
        updatedAt: new Date(),
      });

      const config = await getAlertConfig("cfg-1");

      expect(config.usageSpikeEnabled).toBe(true);
      expect(config.usageSpikeThresholdPercent).toBe(25);
      // Other fields should still have defaults
      expect(config.storageLimitEnabled).toBe(false);
      expect(config.missingBackupEnabled).toBe(false);
    });

    it("should merge partial config with defaults", async () => {
      // Stored config only has some fields — rest should come from defaults
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        key: "storage.alerts.cfg-1",
        value: JSON.stringify({ usageSpikeEnabled: true }),
        description: null,
        updatedAt: new Date(),
      });

      const config = await getAlertConfig("cfg-1");

      expect(config.usageSpikeEnabled).toBe(true);
      expect(config.usageSpikeThresholdPercent).toBe(50);
      expect(config.storageLimitBytes).toBe(10 * 1024 * 1024 * 1024);
    });

    it("should return defaults for invalid JSON", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        key: "storage.alerts.cfg-1",
        value: "not-valid-json{{{",
        description: null,
        updatedAt: new Date(),
      });

      const config = await getAlertConfig("cfg-1");

      expect(config).toEqual(defaultAlertConfig());
    });
  });

  // ── saveAlertConfig ────────────────────────────────────────

  describe("saveAlertConfig", () => {
    it("should upsert config to SystemSetting", async () => {
      prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

      const config = makeAlertConfig({ usageSpikeEnabled: true });
      await saveAlertConfig("cfg-1", config);

      expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "storage.alerts.cfg-1" },
        update: { value: JSON.stringify(config) },
        create: {
          key: "storage.alerts.cfg-1",
          value: JSON.stringify(config),
          description: "Storage alert settings for destination cfg-1",
        },
      });
    });
  });

  // ── getAlertStates / saveAlertStates ───────────────────────

  describe("getAlertStates", () => {
    it("should return defaults when no state exists", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue(null);

      const states = await getAlertStates("cfg-1");

      expect(states).toEqual(defaultAlertStates());
      expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { key: "storage.alerts.cfg-1.state" },
      });
    });

    it("should parse stored JSON state", async () => {
      const stored: StorageAlertStates = {
        ...defaultAlertStates(),
        storageLimit: { active: true, lastNotifiedAt: "2026-02-22T10:00:00Z" },
      };

      prismaMock.systemSetting.findUnique.mockResolvedValue({
        key: "storage.alerts.cfg-1.state",
        value: JSON.stringify(stored),
        description: null,
        updatedAt: new Date(),
      });

      const states = await getAlertStates("cfg-1");

      expect(states.storageLimit.active).toBe(true);
      expect(states.storageLimit.lastNotifiedAt).toBe("2026-02-22T10:00:00Z");
      expect(states.usageSpike.active).toBe(false);
    });

    it("should return defaults for invalid JSON", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        key: "storage.alerts.cfg-1.state",
        value: "broken{{{",
        description: null,
        updatedAt: new Date(),
      });

      const states = await getAlertStates("cfg-1");

      expect(states).toEqual(defaultAlertStates());
    });
  });

  describe("saveAlertStates", () => {
    it("should upsert state to SystemSetting", async () => {
      prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

      const states: StorageAlertStates = {
        ...defaultAlertStates(),
        storageLimit: { active: true, lastNotifiedAt: "2026-02-22T12:00:00Z" },
      };

      await saveAlertStates("cfg-1", states);

      expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "storage.alerts.cfg-1.state" },
        update: { value: JSON.stringify(states) },
        create: {
          key: "storage.alerts.cfg-1.state",
          value: JSON.stringify(states),
          description: "Storage alert state tracking for destination cfg-1",
        },
      });
    });
  });

  // ── checkStorageAlerts ─────────────────────────────────────

  describe("checkStorageAlerts", () => {
    it("should skip entries without configId", async () => {
      await checkStorageAlerts([
        makeEntry({ configId: undefined }),
      ]);

      expect(prismaMock.systemSetting.findUnique).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should skip when all alerts are disabled", async () => {
      mockAlertSetting("cfg-1", {}); // defaults = all disabled

      await checkStorageAlerts([makeEntry()]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should check all enabled alerts for each entry", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        storageLimitEnabled: true,
        missingBackupEnabled: true,
      });

      // Mock snapshot queries for spike check (no spike)
      prismaMock.storageSnapshot.findMany.mockResolvedValue([]);

      await checkStorageAlerts([makeEntry()]);

      // Should have queried snapshots for usage spike and missing backup
      expect(prismaMock.storageSnapshot.findMany).toHaveBeenCalled();
    });

    it("should handle errors per destination without stopping others", async () => {
      // First entry will throw, second should still be processed
      prismaMock.systemSetting.findUnique
        .mockRejectedValueOnce(new Error("DB fail"))
        .mockResolvedValueOnce(null); // defaults = disabled

      await checkStorageAlerts([
        makeEntry({ configId: "cfg-fail" }),
        makeEntry({ configId: "cfg-ok" }),
      ]);

      // Should have attempted both
      expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should process multiple destinations independently", async () => {
      // Both have spike enabled — use mockImplementation to handle both configIds
      prismaMock.systemSetting.findUnique.mockImplementation((async (args: any) => {
        const key: string = args.where.key;
        if (key === "storage.alerts.cfg-1" || key === "storage.alerts.cfg-2") {
          return {
            key,
            value: JSON.stringify(makeAlertConfig({ usageSpikeEnabled: true })),
            description: null,
            updatedAt: new Date(),
          };
        }
        return null; // state keys → default
      }) as any);

      // Both need 2+ snapshots for spike check — return <2 so no notify
      prismaMock.storageSnapshot.findMany.mockResolvedValue([]);

      await checkStorageAlerts([
        makeEntry({ configId: "cfg-1", name: "Storage A" }),
        makeEntry({ configId: "cfg-2", name: "Storage B" }),
      ]);

      // Config + state per destination = 4 findUnique calls
      expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledTimes(4);
    });

    it("should persist state changes after alert checks", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 1000,
      });

      // 950 / 1000 = 95% → triggers alert → state changes
      await checkStorageAlerts([makeEntry({ size: 950 })]);

      expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "storage.alerts.cfg-1.state" },
        })
      );
    });

    it("should not persist state when nothing changed", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
      });

      // No snapshots → spike check returns early → state stays at default
      prismaMock.storageSnapshot.findMany.mockResolvedValue([]);

      await checkStorageAlerts([makeEntry()]);

      // upsert should NOT be called for state (no state change from default)
      expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  // ── Usage Spike Detection ──────────────────────────────────

  describe("checkUsageSpike (via checkStorageAlerts)", () => {
    it("should not alert when only 1 snapshot exists", async () => {
      mockAlertSetting("cfg-1", { usageSpikeEnabled: true });

      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(1073741824) } as any,
      ]);

      await checkStorageAlerts([makeEntry()]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should not alert when change is below threshold", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 50,
      });

      // 1 GB → 1.2 GB = 20% increase (below 50% threshold)
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(1288490188) } as any, // current (most recent)
        { size: BigInt(1073741824) } as any, // previous
      ]);

      await checkStorageAlerts([makeEntry({ size: 1288490188 })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should alert when size increases above threshold", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 50,
      });

      // 1 GB → 2 GB = 100% increase (above 50% threshold)
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(2147483648) } as any, // current
        { size: BigInt(1073741824) } as any, // previous
      ]);

      await checkStorageAlerts([makeEntry({ size: 2147483648 })]);

      expect(mockNotify).toHaveBeenCalledOnce();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
          data: expect.objectContaining({
            storageName: "Test Storage",
            previousSize: 1073741824,
            currentSize: 2147483648,
          }),
        })
      );
    });

    it("should alert when size decreases beyond threshold", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 40,
      });

      // 2 GB → 1 GB = -50% decrease (|50%| > 40% threshold)
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(1073741824) } as any, // current
        { size: BigInt(2147483648) } as any, // previous
      ]);

      await checkStorageAlerts([makeEntry({ size: 1073741824 })]);

      expect(mockNotify).toHaveBeenCalledOnce();
      const call = mockNotify.mock.calls[0][0];
      expect(call.eventType).toBe(NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE);
      expect(call.data.changePercent).toBeLessThan(0);
    });

    it("should handle exactly at threshold (50% change = 50% threshold)", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 50,
      });

      // 1 GB → 1.5 GB = exactly 50%
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(1610612736) } as any,
        { size: BigInt(1073741824) } as any,
      ]);

      await checkStorageAlerts([makeEntry({ size: 1610612736 })]);

      // >= threshold means it should fire
      expect(mockNotify).toHaveBeenCalledOnce();
    });

    it("should not alert when previous size is 0 (avoid division by zero)", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 1,
      });

      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(1073741824) } as any,
        { size: BigInt(0) } as any, // previous was 0
      ]);

      await checkStorageAlerts([makeEntry({ size: 1073741824 })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should not fire spike check when usageSpikeEnabled is false", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: false,
        storageLimitEnabled: false,
        missingBackupEnabled: false,
      });

      await checkStorageAlerts([makeEntry()]);

      expect(prismaMock.storageSnapshot.findMany).not.toHaveBeenCalled();
    });
  });

  // ── Storage Limit Warning ──────────────────────────────────

  describe("checkStorageLimit (via checkStorageAlerts)", () => {
    it("should alert when usage is at 90% of limit", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 10 * 1024 * 1024 * 1024, // 10 GB
      });

      // 9 GB = 90% of 10 GB
      const size = 9 * 1024 * 1024 * 1024;
      await checkStorageAlerts([makeEntry({ size })]);

      expect(mockNotify).toHaveBeenCalledOnce();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
          data: expect.objectContaining({
            storageName: "Test Storage",
            currentSize: size,
            limitSize: 10 * 1024 * 1024 * 1024,
          }),
        })
      );
    });

    it("should alert when usage exceeds limit (100%+)", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
      });

      // 6 GB = 120% of 5 GB
      const size = 6 * 1024 * 1024 * 1024;
      await checkStorageAlerts([makeEntry({ size })]);

      expect(mockNotify).toHaveBeenCalledOnce();
      const call = mockNotify.mock.calls[0][0];
      expect(call.data.usagePercent).toBeGreaterThan(100);
    });

    it("should not alert when usage is below 90%", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 10 * 1024 * 1024 * 1024, // 10 GB
      });

      // 8 GB = 80% of 10 GB (below 90%)
      const size = 8 * 1024 * 1024 * 1024;
      await checkStorageAlerts([makeEntry({ size })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should not alert when limit is 0", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 0,
      });

      await checkStorageAlerts([makeEntry({ size: 999999 })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should use correct percentage calculation", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: true,
        storageLimitBytes: 1000,
      });

      // 950 / 1000 = 95%
      await checkStorageAlerts([makeEntry({ size: 950 })]);

      expect(mockNotify).toHaveBeenCalledOnce();
      const call = mockNotify.mock.calls[0][0];
      expect(call.data.usagePercent).toBeCloseTo(95, 1);
    });

    it("should not fire limit check when storageLimitEnabled is false", async () => {
      mockAlertSetting("cfg-1", {
        storageLimitEnabled: false,
        storageLimitBytes: 100, // small limit, but disabled
      });

      await checkStorageAlerts([makeEntry({ size: 999999999 })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  // ── Missing Backup Detection ───────────────────────────────

  describe("checkMissingBackup (via checkStorageAlerts)", () => {
    it("should not alert when only 1 snapshot exists", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 24,
      });

      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { count: 10, createdAt: new Date("2026-02-22T11:00:00Z") } as any,
      ]);

      await checkStorageAlerts([makeEntry()]);

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should alert when backup count has not changed beyond threshold", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 24,
      });

      // All snapshots in the last 48 hours have count=10 (no new backup)
      // The oldest is 48 hours ago
      const now = new Date("2026-02-22T12:00:00Z");
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { count: 10, createdAt: now } as any,
        { count: 10, createdAt: new Date("2026-02-22T11:00:00Z") } as any,
        { count: 10, createdAt: new Date("2026-02-22T10:00:00Z") } as any,
        { count: 10, createdAt: new Date("2026-02-21T12:00:00Z") } as any,
        { count: 10, createdAt: new Date("2026-02-20T12:00:00Z") } as any, // 48h ago
      ]);

      await checkStorageAlerts([makeEntry()]);

      expect(mockNotify).toHaveBeenCalledOnce();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
          data: expect.objectContaining({
            storageName: "Test Storage",
            thresholdHours: 24,
          }),
        })
      );
    });

    it("should not alert when backup count changed recently", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 48,
      });

      // Count changed 2 hours ago (10 → 11)
      const now = new Date("2026-02-22T12:00:00Z");
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { count: 11, createdAt: now } as any,
        { count: 11, createdAt: new Date("2026-02-22T11:00:00Z") } as any,
        { count: 10, createdAt: new Date("2026-02-22T10:00:00Z") } as any, // change here
        { count: 10, createdAt: new Date("2026-02-20T12:00:00Z") } as any,
      ]);

      await checkStorageAlerts([makeEntry()]);

      // LastChangeAt would be snapshot[1] (2026-02-22T11:00:00Z) = 1h ago
      // 1h < 48h threshold → no alert
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should use oldest snapshot when count never changed", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 24,
      });

      // All have same count, oldest is 30 hours ago
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { count: 5, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
        { count: 5, createdAt: new Date("2026-02-22T06:00:00Z") } as any,
        { count: 5, createdAt: new Date("2026-02-21T06:00:00Z") } as any, // 30h ago
      ]);

      await checkStorageAlerts([makeEntry()]);

      // 30h > 24h → should alert
      expect(mockNotify).toHaveBeenCalledOnce();
    });

    it("should not alert when threshold hours is 0", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 0,
      });

      await checkStorageAlerts([makeEntry()]);

      expect(prismaMock.storageSnapshot.findMany).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should not fire missing backup check when disabled", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: false,
        missingBackupHours: 1, // very small, but disabled
      });

      await checkStorageAlerts([makeEntry()]);

      // Should not even query snapshots for this check
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should include hoursSinceLastBackup in notification data", async () => {
      mockAlertSetting("cfg-1", {
        missingBackupEnabled: true,
        missingBackupHours: 10,
      });

      // Count didn't change — oldest snapshot is 25h ago
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { count: 3, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
        { count: 3, createdAt: new Date("2026-02-21T11:00:00Z") } as any, // 25h ago
      ]);

      await checkStorageAlerts([makeEntry()]);

      expect(mockNotify).toHaveBeenCalledOnce();
      const call = mockNotify.mock.calls[0][0];
      expect(call.data.hoursSinceLastBackup).toBe(25);
      expect(call.data.thresholdHours).toBe(10);
    });
  });

  // ── Combined Alert Scenarios ───────────────────────────────

  describe("combined scenarios", () => {
    it("should fire multiple alerts for same destination", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 10,
        storageLimitEnabled: true,
        storageLimitBytes: 1000,
      });

      // Spike: 500 → 950 = 90% increase (above 10%)
      prismaMock.storageSnapshot.findMany.mockResolvedValue([
        { size: BigInt(950) } as any,
        { size: BigInt(500) } as any,
      ]);

      // Limit: 950 / 1000 = 95% (above 90%)
      await checkStorageAlerts([makeEntry({ size: 950 })]);

      // Should have fired both spike and limit alerts
      expect(mockNotify).toHaveBeenCalledTimes(2);

      const eventTypes = mockNotify.mock.calls.map((c: any[]) => c[0].eventType);
      expect(eventTypes).toContain(NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE);
      expect(eventTypes).toContain(NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING);
    });

    it("should not fire any alerts when usage is healthy", async () => {
      mockAlertSetting("cfg-1", {
        usageSpikeEnabled: true,
        usageSpikeThresholdPercent: 50,
        storageLimitEnabled: true,
        storageLimitBytes: 100 * 1024 * 1024 * 1024, // 100 GB
        missingBackupEnabled: true,
        missingBackupHours: 48,
      });

      // Spike: 1 GB → 1.1 GB = 10% (below 50%)
      // Limit: 1.1 GB / 100 GB = 1.1% (well below 90%)
      // Missing: count changed 1h ago
      prismaMock.storageSnapshot.findMany
        .mockResolvedValueOnce([
          // For spike check
          { size: BigInt(1181116006) } as any,
          { size: BigInt(1073741824) } as any,
        ])
        .mockResolvedValueOnce([
          // For missing backup check
          { count: 11, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
          { count: 10, createdAt: new Date("2026-02-22T11:00:00Z") } as any,
        ]);

      await checkStorageAlerts([makeEntry({ size: 1181116006 })]);

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  // ── Alert Deduplication & Cooldown ─────────────────────────

  describe("alert deduplication", () => {
    describe("storage limit deduplication", () => {
      it("should not re-send when alert is already active and within cooldown", async () => {
        // Alert was sent 2 hours ago → within 24h cooldown
        mockAlertSetting("cfg-1",
          { storageLimitEnabled: true, storageLimitBytes: 1000 },
          { storageLimit: { active: true, lastNotifiedAt: "2026-02-22T10:00:00Z" } }
        );

        // 950 / 1000 = 95% → condition still met
        await checkStorageAlerts([makeEntry({ size: 950 })]);

        expect(mockNotify).not.toHaveBeenCalled();
      });

      it("should re-send as reminder after cooldown expires (24h)", async () => {
        // Alert was sent 25 hours ago → cooldown expired
        mockAlertSetting("cfg-1",
          { storageLimitEnabled: true, storageLimitBytes: 1000 },
          { storageLimit: { active: true, lastNotifiedAt: "2026-02-21T11:00:00Z" } }
        );

        // 950 / 1000 = 95% → condition still met, but cooldown expired
        await checkStorageAlerts([makeEntry({ size: 950 })]);

        expect(mockNotify).toHaveBeenCalledOnce();
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
          })
        );
      });

      it("should reset state when condition resolves", async () => {
        // Alert was previously active
        mockAlertSetting("cfg-1",
          { storageLimitEnabled: true, storageLimitBytes: 1000 },
          { storageLimit: { active: true, lastNotifiedAt: "2026-02-22T10:00:00Z" } }
        );

        // 800 / 1000 = 80% → condition resolved
        await checkStorageAlerts([makeEntry({ size: 800 })]);

        expect(mockNotify).not.toHaveBeenCalled();

        // Verify state was persisted (reset to inactive)
        const upsertCall = prismaMock.systemSetting.upsert.mock.calls.find(
          (c: any[]) => c[0].where.key === "storage.alerts.cfg-1.state"
        );
        const savedState = JSON.parse(upsertCall![0].update.value as string);
        expect(savedState.storageLimit.active).toBe(false);
        expect(savedState.storageLimit.lastNotifiedAt).toBeNull();
      });

      it("should fire immediately after condition resolves and re-triggers", async () => {
        // State is inactive (was previously resolved)
        mockAlertSetting("cfg-1",
          { storageLimitEnabled: true, storageLimitBytes: 1000 }
        );

        // 950 / 1000 = 95% → condition triggers freshly
        await checkStorageAlerts([makeEntry({ size: 950 })]);

        expect(mockNotify).toHaveBeenCalledOnce();
      });
    });

    describe("missing backup deduplication", () => {
      it("should not re-send when alert is already active and within cooldown", async () => {
        // Alert was sent 6 hours ago → within 24h cooldown
        mockAlertSetting("cfg-1",
          { missingBackupEnabled: true, missingBackupHours: 24 },
          { missingBackup: { active: true, lastNotifiedAt: "2026-02-22T06:00:00Z" } }
        );

        // Count unchanged for 30h → condition still met
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { count: 5, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
          { count: 5, createdAt: new Date("2026-02-21T06:00:00Z") } as any, // 30h ago
        ]);

        await checkStorageAlerts([makeEntry()]);

        expect(mockNotify).not.toHaveBeenCalled();
      });

      it("should re-send as reminder after cooldown expires", async () => {
        // Alert was sent 25 hours ago → cooldown expired
        mockAlertSetting("cfg-1",
          { missingBackupEnabled: true, missingBackupHours: 10 },
          { missingBackup: { active: true, lastNotifiedAt: "2026-02-21T11:00:00Z" } }
        );

        // Count unchanged for 30h → still triggered, cooldown expired
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { count: 3, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
          { count: 3, createdAt: new Date("2026-02-21T06:00:00Z") } as any,
        ]);

        await checkStorageAlerts([makeEntry()]);

        expect(mockNotify).toHaveBeenCalledOnce();
      });

      it("should reset state when a new backup appears", async () => {
        // Missing backup alert was active
        mockAlertSetting("cfg-1",
          { missingBackupEnabled: true, missingBackupHours: 24 },
          { missingBackup: { active: true, lastNotifiedAt: "2026-02-22T06:00:00Z" } }
        );

        // Count changed 1h ago → condition resolved
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { count: 6, createdAt: new Date("2026-02-22T12:00:00Z") } as any,
          { count: 6, createdAt: new Date("2026-02-22T11:00:00Z") } as any,
          { count: 5, createdAt: new Date("2026-02-22T10:00:00Z") } as any,
        ]);

        await checkStorageAlerts([makeEntry()]);

        expect(mockNotify).not.toHaveBeenCalled();

        // State should be saved (reset to inactive)
        const upsertCall = prismaMock.systemSetting.upsert.mock.calls.find(
          (c: any[]) => c[0].where.key === "storage.alerts.cfg-1.state"
        );
        const savedState = JSON.parse(upsertCall![0].update.value as string);
        expect(savedState.missingBackup.active).toBe(false);
      });
    });

    describe("usage spike deduplication", () => {
      it("should not re-send spike when already active and within cooldown", async () => {
        // Spike alert sent 1 hour ago
        mockAlertSetting("cfg-1",
          { usageSpikeEnabled: true, usageSpikeThresholdPercent: 50 },
          { usageSpike: { active: true, lastNotifiedAt: "2026-02-22T11:00:00Z" } }
        );

        // Still a spike in the latest snapshots
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { size: BigInt(2147483648) } as any,
          { size: BigInt(1073741824) } as any,
        ]);

        await checkStorageAlerts([makeEntry({ size: 2147483648 })]);

        expect(mockNotify).not.toHaveBeenCalled();
      });

      it("should reset spike state when no spike is detected", async () => {
        // Spike was active
        mockAlertSetting("cfg-1",
          { usageSpikeEnabled: true, usageSpikeThresholdPercent: 50 },
          { usageSpike: { active: true, lastNotifiedAt: "2026-02-22T10:00:00Z" } }
        );

        // No spike (only 5% change)
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { size: BigInt(1127428915) } as any, // ~5% increase
          { size: BigInt(1073741824) } as any,
        ]);

        await checkStorageAlerts([makeEntry({ size: 1127428915 })]);

        expect(mockNotify).not.toHaveBeenCalled();

        // State should be saved (reset)
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { key: "storage.alerts.cfg-1.state" },
          })
        );
      });

      it("should fire again after spike resolves and new spike occurs", async () => {
        // No prior alert state (spike was resolved)
        mockAlertSetting("cfg-1", {
          usageSpikeEnabled: true,
          usageSpikeThresholdPercent: 50,
        });

        // New spike: 100% increase
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { size: BigInt(2147483648) } as any,
          { size: BigInt(1073741824) } as any,
        ]);

        await checkStorageAlerts([makeEntry({ size: 2147483648 })]);

        expect(mockNotify).toHaveBeenCalledOnce();
      });
    });

    describe("cooldown constant", () => {
      it("should have a 24-hour cooldown period", () => {
        expect(ALERT_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
      });
    });

    describe("disabled alert resets state", () => {
      it("should reset active state when alert type is disabled", async () => {
        // Limit was active, but now storageLimitEnabled is false
        mockAlertSetting("cfg-1",
          {
            usageSpikeEnabled: true, // at least one enabled so it doesn't skip entirely
            storageLimitEnabled: false,
          },
          { storageLimit: { active: true, lastNotifiedAt: "2026-02-22T10:00:00Z" } }
        );

        // Need snapshots for spike check (no spike)
        prismaMock.storageSnapshot.findMany.mockResolvedValue([
          { size: BigInt(1073741824) } as any,
          { size: BigInt(1073741824) } as any, // no change = no spike
        ]);

        await checkStorageAlerts([makeEntry()]);

        expect(mockNotify).not.toHaveBeenCalled();

        // State should be saved with storageLimit reset
        const upsertCall = prismaMock.systemSetting.upsert.mock.calls.find(
          (c: any[]) => c[0].where.key === "storage.alerts.cfg-1.state"
        );
        const savedState = JSON.parse(upsertCall![0].update.value as string);
        expect(savedState.storageLimit.active).toBe(false);
        expect(savedState.storageLimit.lastNotifiedAt).toBeNull();
      });
    });
  });
});
