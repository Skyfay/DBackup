/**
 * Storage Alert Service
 *
 * Checks storage snapshots against user-configured thresholds and
 * dispatches notifications through the system notification framework.
 *
 * Alert configuration is stored per-destination in SystemSetting with
 * keys like "storage.alerts.<configId>".
 *
 * Triggered by saveStorageSnapshots() during the storage stats refresh cycle.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import { notify } from "@/services/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import type { StorageVolumeEntry } from "@/services/dashboard-service";

const log = logger.child({ service: "StorageAlertService" });

// ── Alert Configuration Types ──────────────────────────────────

export interface StorageAlertConfig {
  /** Enable usage spike detection */
  usageSpikeEnabled: boolean;
  /** Percentage threshold for spike detection (e.g. 50 = 50%) */
  usageSpikeThresholdPercent: number;

  /** Enable storage limit warning */
  storageLimitEnabled: boolean;
  /** Maximum storage size in bytes */
  storageLimitBytes: number;

  /** Enable missing backup detection */
  missingBackupEnabled: boolean;
  /** Hours threshold after which a missing backup alert is sent */
  missingBackupHours: number;
}

/** Default configuration for new destinations */
export function defaultAlertConfig(): StorageAlertConfig {
  return {
    usageSpikeEnabled: false,
    usageSpikeThresholdPercent: 50,
    storageLimitEnabled: false,
    storageLimitBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    missingBackupEnabled: false,
    missingBackupHours: 48,
  };
}

// ── Config Persistence ─────────────────────────────────────────

function settingKey(configId: string): string {
  return `storage.alerts.${configId}`;
}

/** Load alert configuration for a storage destination */
export async function getAlertConfig(
  configId: string
): Promise<StorageAlertConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: settingKey(configId) },
  });

  if (!row) return defaultAlertConfig();

  try {
    return { ...defaultAlertConfig(), ...JSON.parse(row.value) };
  } catch {
    log.warn("Invalid storage alert config JSON, returning defaults", {
      configId,
    });
    return defaultAlertConfig();
  }
}

/** Save alert configuration for a storage destination */
export async function saveAlertConfig(
  configId: string,
  config: StorageAlertConfig
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: settingKey(configId) },
    update: { value: JSON.stringify(config) },
    create: {
      key: settingKey(configId),
      value: JSON.stringify(config),
      description: `Storage alert settings for destination ${configId}`,
    },
  });
}

// ── Alert Checks ───────────────────────────────────────────────

/**
 * Check all storage alert conditions for the given destinations.
 * Called after saving new storage snapshots.
 */
export async function checkStorageAlerts(
  entries: StorageVolumeEntry[]
): Promise<void> {
  for (const entry of entries) {
    if (!entry.configId) continue;

    try {
      const config = await getAlertConfig(entry.configId);

      // Skip if no alerts are enabled
      if (
        !config.usageSpikeEnabled &&
        !config.storageLimitEnabled &&
        !config.missingBackupEnabled
      ) {
        continue;
      }

      if (config.usageSpikeEnabled) {
        await checkUsageSpike(entry, config);
      }

      if (config.storageLimitEnabled) {
        await checkStorageLimit(entry, config);
      }

      if (config.missingBackupEnabled) {
        await checkMissingBackup(entry, config);
      }
    } catch (error) {
      log.error(
        "Failed to check storage alerts for destination",
        { configId: entry.configId, name: entry.name },
        wrapError(error)
      );
    }
  }
}

/**
 * Detect significant storage size changes between the latest
 * two snapshots for a destination.
 */
async function checkUsageSpike(
  entry: StorageVolumeEntry,
  config: StorageAlertConfig
): Promise<void> {
  // Get the previous snapshot (second most recent)
  const previousSnapshots = await prisma.storageSnapshot.findMany({
    where: { adapterConfigId: entry.configId! },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { size: true },
  });

  // Need at least 2 snapshots (1 previous + the one just saved)
  if (previousSnapshots.length < 2) return;

  const previousSize = Number(previousSnapshots[1].size);
  const currentSize = entry.size;

  // Avoid division by zero
  if (previousSize === 0) return;

  const changePercent =
    ((currentSize - previousSize) / previousSize) * 100;

  if (Math.abs(changePercent) >= config.usageSpikeThresholdPercent) {
    log.info("Storage usage spike detected", {
      storageName: entry.name,
      previousSize,
      currentSize,
      changePercent: changePercent.toFixed(1),
    });

    await notify({
      eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
      data: {
        storageName: entry.name,
        previousSize,
        currentSize,
        changePercent,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * Check if storage usage exceeds the configured size limit.
 */
async function checkStorageLimit(
  entry: StorageVolumeEntry,
  config: StorageAlertConfig
): Promise<void> {
  if (config.storageLimitBytes <= 0) return;

  const usagePercent =
    (entry.size / config.storageLimitBytes) * 100;

  // Alert when usage is at or above 90% of the limit
  if (usagePercent >= 90) {
    log.info("Storage limit warning triggered", {
      storageName: entry.name,
      currentSize: entry.size,
      limitSize: config.storageLimitBytes,
      usagePercent: usagePercent.toFixed(1),
    });

    await notify({
      eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
      data: {
        storageName: entry.name,
        currentSize: entry.size,
        limitSize: config.storageLimitBytes,
        usagePercent,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * Check if too much time has passed since the last backup count increase.
 */
async function checkMissingBackup(
  entry: StorageVolumeEntry,
  config: StorageAlertConfig
): Promise<void> {
  if (config.missingBackupHours <= 0) return;

  // Find the most recent snapshot where count was different (a backup was added)
  const snapshots = await prisma.storageSnapshot.findMany({
    where: { adapterConfigId: entry.configId! },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { count: true, createdAt: true },
  });

  if (snapshots.length < 2) return;

  // Find the first snapshot with a count change (i.e. the last time a new backup appeared)
  const currentCount = snapshots[0].count;
  let lastChangeAt: Date | null = null;

  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i].count !== currentCount) {
      // The change happened between snapshot i and i-1
      lastChangeAt = snapshots[i - 1].createdAt;
      break;
    }
  }

  // If no count change found in history, use the oldest snapshot as reference
  if (!lastChangeAt) {
    lastChangeAt = snapshots[snapshots.length - 1].createdAt;
  }

  const hoursSinceLastBackup =
    (Date.now() - lastChangeAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastBackup >= config.missingBackupHours) {
    log.info("Missing backup alert triggered", {
      storageName: entry.name,
      hoursSinceLastBackup: Math.round(hoursSinceLastBackup),
      thresholdHours: config.missingBackupHours,
    });

    await notify({
      eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
      data: {
        storageName: entry.name,
        lastBackupAt: lastChangeAt.toISOString(),
        thresholdHours: config.missingBackupHours,
        hoursSinceLastBackup: Math.round(hoursSinceLastBackup),
        timestamp: new Date().toISOString(),
      },
    });
  }
}
