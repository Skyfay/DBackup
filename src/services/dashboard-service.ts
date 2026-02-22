import prisma from "@/lib/prisma";
import { format, subDays, startOfDay } from "date-fns";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import { checkStorageAlerts } from "@/services/storage-alert-service";

export interface DashboardStats {
  totalJobs: number;
  activeSchedules: number;
  success24h: number;
  failed24h: number;
  totalSnapshots: number;
  totalStorageBytes: number;
  successRate30d: number;
}

export interface ActivityDataPoint {
  date: string;
  completed: number;
  failed: number;
  running: number;
  pending: number;
}

export interface JobStatusDistribution {
  status: string;
  count: number;
  fill: string;
}

export interface StorageVolumeEntry {
  configId?: string;
  name: string;
  adapterId: string;
  size: number;
  count: number;
}

export interface StorageSnapshotEntry {
  date: string;
  size: number;
  count: number;
}

export interface LatestJobEntry {
  id: string;
  type: string;
  status: string;
  jobName: string | null;
  sourceName: string | null;
  sourceType: string | null;
  databaseName: string | null;
  startedAt: Date;
  duration: number;
}

/**
 * Fetches all KPI stats for the dashboard overview cards.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = subDays(now, 30);

  const [
    totalJobs,
    activeSchedules,
    success24h,
    failed24h,
    total30d,
    success30d,
  ] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({
      where: { enabled: true, schedule: { not: "" } },
    }),
    prisma.execution.count({
      where: { status: "Success", startedAt: { gte: twentyFourHoursAgo } },
    }),
    prisma.execution.count({
      where: { status: "Failed", startedAt: { gte: twentyFourHoursAgo } },
    }),
    prisma.execution.count({
      where: {
        startedAt: { gte: thirtyDaysAgo },
        status: { in: ["Success", "Failed"] },
      },
    }),
    prisma.execution.count({
      where: {
        startedAt: { gte: thirtyDaysAgo },
        status: "Success",
      },
    }),
  ]);

  // Get actual storage stats from adapters (accurate file counts and sizes)
  const storageVolume = await getStorageVolume();
  const totalSnapshots = storageVolume.reduce((sum, s) => sum + s.count, 0);
  const totalStorageBytes = storageVolume.reduce((sum, s) => sum + s.size, 0);

  const successRate30d = total30d > 0 ? Math.round((success30d / total30d) * 100) : 100;

  return {
    totalJobs,
    activeSchedules,
    success24h,
    failed24h,
    totalSnapshots,
    totalStorageBytes,
    successRate30d,
  };
}

/**
 * Fetches execution activity grouped by day for the last N days.
 * Used for the Jobs Activity stacked bar chart.
 */
export async function getActivityData(days: number = 14): Promise<ActivityDataPoint[]> {
  const now = new Date();
  const startDate = startOfDay(subDays(now, days - 1));

  const executions = await prisma.execution.findMany({
    where: { startedAt: { gte: startDate } },
    select: { status: true, startedAt: true },
  });

  // Build a map of date -> status counts
  const dateMap = new Map<string, ActivityDataPoint>();

  // Initialize all days with zeros
  for (let i = 0; i < days; i++) {
    const date = format(subDays(now, days - 1 - i), "MMM d");
    dateMap.set(date, { date, completed: 0, failed: 0, running: 0, pending: 0 });
  }

  // Count executions per day
  for (const exec of executions) {
    const dateKey = format(exec.startedAt, "MMM d");
    const entry = dateMap.get(dateKey);
    if (!entry) continue;

    switch (exec.status) {
      case "Success":
        entry.completed++;
        break;
      case "Failed":
        entry.failed++;
        break;
      case "Running":
        entry.running++;
        break;
      case "Pending":
        entry.pending++;
        break;
    }
  }

  return Array.from(dateMap.values());
}

/**
 * Fetches job status distribution for the last 30 days.
 * Used for the Job Status donut chart.
 */
export async function getJobStatusDistribution(): Promise<JobStatusDistribution[]> {
  const thirtyDaysAgo = subDays(new Date(), 30);

  const executions = await prisma.execution.findMany({
    where: { startedAt: { gte: thirtyDaysAgo } },
    select: { status: true },
  });

  const counts: Record<string, number> = {
    Success: 0,
    Failed: 0,
    Running: 0,
    Pending: 0,
  };

  for (const exec of executions) {
    if (exec.status in counts) {
      counts[exec.status]++;
    }
  }

  const colorMap: Record<string, string> = {
    Success: "var(--color-completed)",
    Failed: "var(--color-failed)",
    Running: "var(--color-running)",
    Pending: "var(--color-pending)",
  };

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status,
      count,
      fill: colorMap[status] ?? "var(--color-chart-1)",
    }));
}

const STORAGE_CACHE_KEY = "cache.storageVolume";
const STORAGE_CACHE_UPDATED_KEY = "cache.storageVolume.updatedAt";

/**
 * Returns cached storage volume data from the database.
 * If no cache exists yet, triggers a live refresh to populate it (first load may be slower).
 * Subsequent loads are instant from cache.
 * The cache is refreshed by the "Refresh Storage Statistics" system task (default: hourly)
 * and automatically after backups, retention, and manual file deletions.
 */
export async function getStorageVolume(): Promise<StorageVolumeEntry[]> {
  // Try to read cached data first
  const cached = await prisma.systemSetting.findUnique({
    where: { key: STORAGE_CACHE_KEY },
  });

  if (cached) {
    try {
      return JSON.parse(cached.value) as StorageVolumeEntry[];
    } catch {
      // Cache corrupted, fall through to live refresh
    }
  }

  // No cache yet — do a live refresh to populate it (first load only)
  // This ensures accurate data from the start instead of inaccurate DB estimation
  try {
    return await refreshStorageStatsCache();
  } catch {
    // If live refresh fails entirely, fall back to DB estimation
    return getStorageVolumeFromDB();
  }
}

/**
 * Returns the timestamp when the storage stats cache was last refreshed.
 */
export async function getStorageVolumeCacheAge(): Promise<string | null> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: STORAGE_CACHE_UPDATED_KEY },
  });
  return setting?.value ?? null;
}

/**
 * Refreshes the storage volume cache by querying all storage adapters live.
 * Called by the "Refresh Storage Statistics" system task (default: every hour)
 * and after each backup completion.
 */
export async function refreshStorageStatsCache(): Promise<StorageVolumeEntry[]> {
  const log = logger.child({ service: "StorageStatsCache" });
  log.info("Refreshing storage statistics cache");

  registerAdapters();

  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage" },
  });

  if (storageAdapters.length === 0) {
    await saveStorageCache([]);
    return [];
  }

  const results: StorageVolumeEntry[] = [];

  // Query all adapters in parallel for maximum speed
  const promises = storageAdapters.map(async (adapterConfig) => {
    try {
      const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
      if (!adapter) return null;

      const config = decryptConfig(JSON.parse(adapterConfig.config));
      const files = await adapter.list(config, "");

      // Filter out .meta.json sidecar files (they are not backup data)
      const backupFiles = files.filter((f) => !f.name.endsWith(".meta.json"));
      const totalSize = backupFiles.reduce((sum, f) => sum + (f.size || 0), 0);

      return {
        configId: adapterConfig.id,
        name: adapterConfig.name,
        adapterId: adapterConfig.adapterId,
        size: totalSize,
        count: backupFiles.length,
      };
    } catch (error) {
      log.warn("Failed to query storage adapter, using DB fallback", {
        adapter: adapterConfig.name,
        adapterId: adapterConfig.adapterId,
      }, wrapError(error));

      // Fall back to DB aggregation for this adapter
      const executions = await prisma.execution.findMany({
        where: {
          status: "Success",
          size: { not: null },
          job: { destinationId: adapterConfig.id },
        },
        select: { size: true },
      });

      const totalSize = executions.reduce((sum, ex) => sum + Number(ex.size ?? 0), 0);

      return {
        configId: adapterConfig.id,
        name: adapterConfig.name,
        adapterId: adapterConfig.adapterId,
        size: totalSize,
        count: executions.length,
      };
    }
  });

  const settled = await Promise.all(promises);
  for (const entry of settled) {
    if (entry) results.push(entry);
  }

  await saveStorageCache(results);

  // Save historical snapshots for storage usage over time charts
  await saveStorageSnapshots(results);

  // Clean up old snapshots (older than 90 days)
  const cleaned = await cleanupOldSnapshots();
  if (cleaned > 0) {
    log.info("Cleaned up old storage snapshots", { deleted: cleaned });
  }

  log.info("Storage statistics cache refreshed", {
    destinations: results.length,
    totalSize: results.reduce((sum, r) => sum + r.size, 0),
    totalFiles: results.reduce((sum, r) => sum + r.count, 0),
  });

  return results;
}

/**
 * DB-based storage volume estimation using the Execution table.
 * Used as initial fallback when no cache exists yet.
 */
async function getStorageVolumeFromDB(): Promise<StorageVolumeEntry[]> {
  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage" },
  });

  if (storageAdapters.length === 0) return [];

  const results: StorageVolumeEntry[] = [];

  for (const adapterConfig of storageAdapters) {
    const executions = await prisma.execution.findMany({
      where: {
        status: "Success",
        size: { not: null },
        job: { destinationId: adapterConfig.id },
      },
      select: { size: true },
    });

    const totalSize = executions.reduce((sum, ex) => sum + Number(ex.size ?? 0), 0);

    results.push({
      name: adapterConfig.name,
      adapterId: adapterConfig.adapterId,
      size: totalSize,
      count: executions.length,
    });
  }

  return results;
}

/**
 * Persists storage volume data to the SystemSetting cache.
 */
async function saveStorageCache(data: StorageVolumeEntry[]): Promise<void> {
  const now = new Date().toISOString();

  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: STORAGE_CACHE_KEY },
      update: { value: JSON.stringify(data) },
      create: {
        key: STORAGE_CACHE_KEY,
        value: JSON.stringify(data),
        description: "Cached storage volume statistics for dashboard",
      },
    }),
    prisma.systemSetting.upsert({
      where: { key: STORAGE_CACHE_UPDATED_KEY },
      update: { value: now },
      create: {
        key: STORAGE_CACHE_UPDATED_KEY,
        value: now,
        description: "Timestamp of last storage statistics refresh",
      },
    }),
  ]);
}

/**
 * Fetches the latest job executions for the activity list.
 */
export async function getLatestJobs(limit: number = 7): Promise<LatestJobEntry[]> {
  const executions = await prisma.execution.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      job: {
        include: {
          source: true,
          destination: true,
        },
      },
    },
  });

  return executions.map((exec) => {
    let jobName = exec.job?.name ?? null;
    let sourceName = exec.job?.source?.name ?? null;
    let sourceType = exec.job?.source?.type ?? null;
    let databaseName: string | null = null;

    // Extract metadata if available
    if (exec.metadata) {
      try {
        const meta = JSON.parse(exec.metadata);
        if (meta.jobName) jobName = meta.jobName;
        if (meta.sourceName) sourceName = meta.sourceName;
        if (meta.sourceType) sourceType = meta.sourceType;
        if (meta.databases?.length) {
          databaseName = meta.databases.join(", ");
        }
      } catch {
        // Ignore parse errors
      }
    }

    const duration = exec.endedAt
      ? exec.endedAt.getTime() - exec.startedAt.getTime()
      : 0;

    return {
      id: exec.id,
      type: exec.type,
      status: exec.status,
      jobName: jobName ?? (exec.jobId ? "Deleted Job" : "Manual Action"),
      sourceName,
      sourceType,
      databaseName,
      startedAt: exec.startedAt,
      duration,
    };
  });
}

/**
 * Checks if any executions are currently in Running or Pending status.
 * Used to trigger auto-refresh polling on the dashboard.
 */
export async function hasRunningJobs(): Promise<boolean> {
  const count = await prisma.execution.count({
    where: { status: { in: ["Running", "Pending"] } },
  });
  return count > 0;
}

/**
 * Saves a storage snapshot for each adapter to track usage over time.
 * Called by refreshStorageStatsCache() on every refresh cycle.
 */
async function saveStorageSnapshots(entries: StorageVolumeEntry[]): Promise<void> {
  const log = logger.child({ service: "StorageSnapshots" });

  try {
    const data = entries
      .filter((entry) => entry.configId)
      .map((entry) => ({
        adapterConfigId: entry.configId!,
        adapterName: entry.name,
        adapterId: entry.adapterId,
        size: BigInt(Math.round(entry.size)),
        count: entry.count,
      }));

    if (data.length === 0) return;

    await prisma.storageSnapshot.createMany({ data });

    log.debug("Saved storage snapshots", { count: data.length });

    // Check storage alert conditions against new snapshot data
    try {
      await checkStorageAlerts(entries);
    } catch (alertError) {
      log.warn("Failed to check storage alerts", {}, wrapError(alertError));
    }
  } catch (error) {
    log.warn("Failed to save storage snapshots", {}, wrapError(error));
  }
}

/**
 * Returns historical storage usage data for a specific adapter config.
 * Used for the storage history chart modal on the dashboard.
 */
export async function getStorageHistory(
  configId: string,
  days: number = 30
): Promise<StorageSnapshotEntry[]> {
  const since = subDays(new Date(), days);

  const snapshots = await prisma.storageSnapshot.findMany({
    where: {
      adapterConfigId: configId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    select: {
      size: true,
      count: true,
      createdAt: true,
    },
  });

  return snapshots.map((s) => ({
    date: s.createdAt.toISOString(),
    size: Number(s.size),
    count: s.count,
  }));
}

/**
 * Cleans up old storage snapshots beyond the retention period.
 * Called during storage stats refresh to prevent unbounded growth.
 */
export async function cleanupOldSnapshots(retentionDays: number = 90): Promise<number> {
  const cutoff = subDays(new Date(), retentionDays);

  const result = await prisma.storageSnapshot.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return result.count;
}
