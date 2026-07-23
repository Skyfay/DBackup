import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { subDays, subMonths, addDays, startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { checkStorageAlerts } from "@/services/storage/storage-alert-service";
import { isBackupFile } from "@/lib/core/backup-files";

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
  partial: number;
  running: number;
  pending: number;
  cancelled: number;
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
  /** True when the live adapter scan failed and DB fallback data was used. Snapshots and alerts are skipped for these entries. */
  scanError?: boolean;
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

export interface CalendarDayData {
  date: string;
  total: number;
  completed: number;
  failed: number;
  partial: number;
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
 * Day boundaries are determined by the system scheduler timezone so the chart
 * matches the timezone in which jobs are scheduled.
 */
export async function getActivityData(days: number = 14): Promise<ActivityDataPoint[]> {
  const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
  const timezone = tzSetting?.value || "UTC";

  const now = new Date();
  const startDate = startOfDay(subDays(now, days - 1));

  const executions = await prisma.execution.findMany({
    where: { startedAt: { gte: startDate } },
    select: { status: true, startedAt: true },
  });

  // Build a map of date -> status counts.
  // Dates are formatted in the scheduler timezone so day boundaries align with
  // the timezone in which cron expressions are evaluated.
  const dateMap = new Map<string, ActivityDataPoint>();

  // Initialize all days with zeros
  for (let i = 0; i < days; i++) {
    const date = formatInTimeZone(subDays(now, days - 1 - i), timezone, "MMM d");
    dateMap.set(date, { date, completed: 0, failed: 0, partial: 0, running: 0, pending: 0, cancelled: 0 });
  }

  // Count executions per day
  for (const exec of executions) {
    const dateKey = formatInTimeZone(exec.startedAt, timezone, "MMM d");
    const entry = dateMap.get(dateKey);
    if (!entry) continue;

    switch (exec.status) {
      case "Success":
        entry.completed++;
        break;
      case "Failed":
        entry.failed++;
        break;
      case "Partial":
        entry.partial++;
        break;
      case "Running":
        entry.running++;
        break;
      case "Pending":
        entry.pending++;
        break;
      case "Cancelled":
        entry.cancelled++;
        break;
    }
  }

  return Array.from(dateMap.values());
}

/**
 * Fetches execution activity grouped by day for the last N months.
 * Used for the Backup Calendar Heatmap widget.
 * Only counts Backup-type executions. Day boundaries respect the system timezone.
 */
export async function getCalendarData(months: number = 12): Promise<CalendarDayData[]> {
  const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
  const timezone = tzSetting?.value || "UTC";

  const now = new Date();
  // Use Date.UTC so cursor steps land on UTC midnights, matching getCalendarDataForYear behavior.
  const subResult = subMonths(now, months);
  const startDate = new Date(Date.UTC(subResult.getUTCFullYear(), subResult.getUTCMonth(), subResult.getUTCDate()));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const executions = await prisma.execution.findMany({
    where: {
      type: "Backup",
      startedAt: { gte: startDate },
    },
    select: { startedAt: true, status: true },
  });

  const dayMap = new Map<string, CalendarDayData>();

  let cursor = startDate;
  while (cursor < endDate) {
    const key = formatInTimeZone(cursor, timezone, "yyyy-MM-dd");
    dayMap.set(key, { date: key, total: 0, completed: 0, failed: 0, partial: 0 });
    cursor = addDays(cursor, 1);
  }

  for (const exec of executions) {
    const key = formatInTimeZone(exec.startedAt, timezone, "yyyy-MM-dd");
    const day = dayMap.get(key);
    if (!day) continue;
    day.total++;
    if (exec.status === "Success") day.completed++;
    else if (exec.status === "Failed") day.failed++;
    else if (exec.status === "Partial") day.partial++;
  }

  return Array.from(dayMap.values());
}

/**
 * Fetches execution activity for a specific calendar year, grouped by day.
 * Used for the year-selector view in the Backup Calendar Heatmap.
 */
export async function getCalendarDataForYear(year: number): Promise<CalendarDayData[]> {
  const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
  const timezone = tzSetting?.value || "UTC";

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const executions = await prisma.execution.findMany({
    where: {
      type: "Backup",
      startedAt: { gte: yearStart, lt: yearEnd },
    },
    select: { startedAt: true, status: true },
  });

  const dayMap = new Map<string, CalendarDayData>();

  // Initialize all 365/366 days of the year so the full grid is always rendered.
  // Future days will have total: 0 and display as empty gray cells.
  let cursor = yearStart;
  while (cursor < yearEnd) {
    const key = formatInTimeZone(cursor, timezone, "yyyy-MM-dd");
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: key, total: 0, completed: 0, failed: 0, partial: 0 });
    }
    cursor = addDays(cursor, 1);
  }

  for (const exec of executions) {
    const key = formatInTimeZone(exec.startedAt, timezone, "yyyy-MM-dd");
    const day = dayMap.get(key);
    if (!day) continue;
    day.total++;
    if (exec.status === "Success") day.completed++;
    else if (exec.status === "Failed") day.failed++;
    else if (exec.status === "Partial") day.partial++;
  }

  return Array.from(dayMap.values());
}

/**
 * Returns all years that have at least one Backup execution, from the earliest to the current year.
 * Used to populate the year selector in the Backup Calendar Heatmap.
 */
export async function getAvailableCalendarYears(): Promise<number[]> {
  const earliest = await prisma.execution.findFirst({
    where: { type: "Backup" },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true },
  });
  const currentYear = new Date().getFullYear();
  if (!earliest) return [currentYear];
  const firstYear = earliest.startedAt.getFullYear();
  return Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i);
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
    Partial: 0,
    Running: 0,
    Pending: 0,
    Cancelled: 0,
  };

  for (const exec of executions) {
    if (exec.status in counts) {
      counts[exec.status]++;
    }
  }

  const colorMap: Record<string, string> = {
    Success: "var(--color-completed)",
    Failed: "var(--color-failed)",
    Partial: "var(--color-partial)",
    Running: "var(--color-running)",
    Pending: "var(--color-pending)",
    Cancelled: "var(--color-cancelled)",
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

  // No cache yet - do a live refresh to populate it (first load only)
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
    where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
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

      const config = await resolveAdapterConfig(adapterConfig);
      const files = (await adapter.list(config, "")).filter(f => {
        const p = f.path.replace(/\\/g, '/');
        return !p.startsWith('.dbackup/') && !p.startsWith('/.dbackup/');
      });

      // Sidecars (.meta.json, .index) are not backup data and must not be counted.
      const backupFiles = files.filter((f) => isBackupFile(f.name));
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
          job: { destinations: { some: { configId: adapterConfig.id } } },
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
        scanError: true,
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
    where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
  });

  if (storageAdapters.length === 0) return [];

  const results: StorageVolumeEntry[] = [];

  for (const adapterConfig of storageAdapters) {
    const executions = await prisma.execution.findMany({
      where: {
        status: "Success",
        size: { not: null },
        job: { destinations: { some: { configId: adapterConfig.id } } },
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
          destinations: { include: { config: true } },
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
    // Skip entries where the live adapter scan failed - their sizes come from DB fallback
    // and are unreliable for snapshot history and spike detection.
    const validEntries = entries.filter((entry) => entry.configId && !entry.scanError);

    if (validEntries.length < entries.length) {
      const skipped = entries.filter((e) => e.scanError).map((e) => e.name);
      log.warn("Skipping snapshots for adapters with scan errors", { skipped });
    }

    const data = validEntries.map((entry) => ({
      adapterConfigId: entry.configId!,
      adapterName: entry.name,
      adapterId: entry.adapterId,
      size: BigInt(Math.round(entry.size)),
      count: entry.count,
    }));

    if (data.length === 0) return;

    await prisma.storageSnapshot.createMany({ data });

    log.debug("Saved storage snapshots", { count: data.length });

    // Check storage alert conditions only for entries with valid live scan data
    try {
      await checkStorageAlerts(validEntries);
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
