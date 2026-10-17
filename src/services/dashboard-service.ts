import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
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
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { isNotConnected } from "@/lib/core/air-gap";
import { currentTenantId } from "@/lib/tenant/current";
import { TENANTS_FOLDER } from "@/lib/tenant/storage-view";
import { providedIds } from "@/services/sharing/provided";

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

export interface StorageVolumeEntry {
  configId?: string;
  /**
   * The tenant whose backups the entry counts: the tenant of the destination, or on a destination it
   * shares with customers one of them, whose backups sit under tenants/<id>/. Entries of an older
   * version lack it and count for the tenant of their destination.
   */
  tenantId?: string;
  name: string;
  adapterId: string;
  size: number;
  count: number;
  /**
   * True when the destination could not be listed at the last refresh. `size` and `count` then
   * hold its last successful scan, taken at `lastScanAt`. Snapshots and alerts skip these entries.
   */
  scanError?: boolean;
  /** When the values of a failed scan were measured, null when the destination was never scanned. */
  lastScanAt?: string | null;
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
  /** Bytes stored by the run, null while it runs or when it stored nothing. */
  size: number | null;
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
    // Every finished run, a partial one counting against the rate like on every page of the dashboard.
    prisma.execution.count({
      where: {
        startedAt: { gte: thirtyDaysAgo },
        status: { in: ["Success", "Partial", "Failed"] },
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
  const cached = await readStorageCache();
  if (cached) return visibleEntries(cached);

  // No cache yet or a corrupted one - do a live refresh to populate it (first load only)
  try {
    return visibleEntries(await refreshStorageStatsCache());
  } catch {
    // If the live refresh fails entirely, show what every destination held at its last scan.
    return getLastScannedStorageVolume();
  }
}

/**
 * The entries the code that runs now may see. The cache holds every tenant: a tenant sees what its
 * own destinations hold of its own backups, and what the destinations other tenants share with it
 * hold of its backups. All tenants sees each destination once, with every tenant's backups on it.
 */
async function visibleEntries(entries: StorageVolumeEntry[]): Promise<StorageVolumeEntry[]> {
  const ids = [...new Set(entries.flatMap((entry) => (entry.configId ? [entry.configId] : [])))];
  const own = new Map((await prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true, tenantId: true } })).map((config) => [config.id, config.tenantId]));
  const tenantId = await currentTenantId();
  if (!tenantId) return combined(entries.filter((entry) => entry.configId && own.has(entry.configId)));
  const provided = await providedIds(tenantId, ids.filter((id) => !own.has(id)));
  return entries.filter((entry) => {
    if (!entry.configId) return false;
    const holder = entry.tenantId ?? own.get(entry.configId);
    return own.has(entry.configId) ? holder === tenantId : provided.has(entry.configId) && entry.tenantId === tenantId;
  });
}

/**
 * What the last refresh measured of one destination for each tenant, unfiltered. For the tenant
 * that shares the destination, which sees the space of every customer on it and never their backups.
 */
export async function storageEntriesOf(configId: string): Promise<StorageVolumeEntry[]> {
  return (await readStorageCache() ?? []).filter((entry) => entry.configId === configId);
}

/** One entry per destination with the backups of every tenant on it, named for the tenant of the destination. */
function destinationTotals(entries: StorageVolumeEntry[], owners: Map<string, string>): StorageVolumeEntry[] {
  return combined(entries).map((entry) => ({ ...entry, tenantId: owners.get(entry.configId!) }));
}

/** One entry per destination, with the backups of every tenant on it. */
function combined(entries: StorageVolumeEntry[]): StorageVolumeEntry[] {
  const byDestination = new Map<string, StorageVolumeEntry>();
  for (const entry of entries) {
    const known = byDestination.get(entry.configId!);
    if (!known) {
      byDestination.set(entry.configId!, { ...entry, tenantId: undefined });
      continue;
    }
    known.size += entry.size;
    known.count += entry.count;
    if (entry.scanError) known.scanError = true;
  }
  return [...byDestination.values()];
}

/**
 * What a destination holds for each tenant. A destination its tenant shares with customers keeps
 * the backups of each of them under tenants/<id>/, which count for that customer, everything else
 * for the tenant of the destination. A destination nobody shares counts for its tenant alone.
 */
function entriesOf(
  destination: { id: string; name: string; adapterId: string; tenantId: string },
  files: { path: string; size?: number }[],
  shared: boolean,
): StorageVolumeEntry[] {
  const totals = new Map<string, { size: number; count: number }>([[destination.tenantId, { size: 0, count: 0 }]]);
  for (const file of files) {
    const clean = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const customer = shared ? new RegExp(`^${TENANTS_FOLDER}/([^/]+)/`).exec(clean)?.[1] : undefined;
    const holder = customer ?? destination.tenantId;
    const total = totals.get(holder) ?? { size: 0, count: 0 };
    total.size += file.size || 0;
    total.count += 1;
    totals.set(holder, total);
  }
  return [...totals].map(([tenantId, total]) => ({
    configId: destination.id,
    tenantId,
    name: destination.name,
    adapterId: destination.adapterId,
    size: total.size,
    count: total.count,
  }));
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

/** The entries of the storage cache, null while there is none or it cannot be read. */
async function readStorageCache(): Promise<StorageVolumeEntry[] | null> {
  const cached = await prisma.systemSetting.findUnique({
    where: { key: STORAGE_CACHE_KEY },
  });
  if (!cached) return null;
  try {
    return JSON.parse(cached.value) as StorageVolumeEntry[];
  } catch {
    return null;
  }
}

// A refresh of some destinations reads the cache and writes it back with the others in it. One
// write at a time, so two backups that end together do not lose each other's values. Kept on
// globalThis like the dashboard cache, so the runner and the routes share it.
const globalForStorageCache = globalThis as unknown as { __dbackupStorageCacheWrite?: Promise<unknown> };

function oneWriteAtATime<T>(write: () => Promise<T>): Promise<T> {
  const turn = (globalForStorageCache.__dbackupStorageCacheWrite ?? Promise.resolve()).then(write);
  globalForStorageCache.__dbackupStorageCacheWrite = turn.catch(() => undefined);
  return turn;
}

/** Which destinations a refresh lists. Without `configIds` it lists every destination. */
export interface StorageRefreshScope {
  /**
   * Only these destinations, like the ones a backup just wrote to. The others keep their cached
   * values, and a destination the cache does not hold yet is listed as well.
   */
  configIds?: string[];
}

/**
 * Refreshes the storage volume cache by querying storage adapters live.
 * Called by the "Refresh Storage Statistics" system task (default: every hour) for every
 * destination, and after backups, retention and deleted files for the destinations they touched.
 * The cache holds the destinations of every tenant, so the refresh reads all of them, also when a
 * run of one tenant asks for it, and answers with all of them.
 */
export function refreshStorageStatsCache(scope: StorageRefreshScope = {}): Promise<StorageVolumeEntry[]> {
  return runAsSystem(() => refreshEveryTenant(scope));
}

async function refreshEveryTenant(scope: StorageRefreshScope): Promise<StorageVolumeEntry[]> {
  const log = logger.child({ service: "StorageStatsCache" });
  log.info("Refreshing storage statistics cache", { destinations: scope.configIds?.length ?? "all" });

  registerAdapters();

  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
  });

  if (storageAdapters.length === 0) {
    await saveStorageCache([]);
    return [];
  }

  const shared = new Set((await prisma.connectionShare.findMany({ where: { id: { in: storageAdapters.map((config) => config.id) } }, select: { id: true } })).map((share) => share.id));

  // Listing every destination after every backup made a busy instance write a snapshot of each
  // destination a few times an hour, and the dashboard read hundreds of thousands of them.
  const partial = scope.configIds ? new Set(scope.configIds) : null;
  const known = partial ? new Set((await readStorageCache() ?? []).map((entry) => entry.configId)) : null;
  const listed = partial && known
    ? storageAdapters.filter((adapterConfig) => partial.has(adapterConfig.id) || !known.has(adapterConfig.id))
    : storageAdapters;

  // Query the adapters in parallel for maximum speed
  const promises = listed.map(async (adapterConfig) => {
    // An air-gapped destination that is not connected keeps the values of its last scan, without a warning.
    if (isNotConnected(adapterConfig)) return lastScannedEntries(adapterConfig);
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
      return entriesOf(adapterConfig, backupFiles, shared.has(adapterConfig.id));
    } catch (error) {
      log.warn("Failed to query storage adapter, keeping its last scanned values", {
        adapter: adapterConfig.name,
        adapterId: adapterConfig.adapterId,
      }, wrapError(error));
      return lastScannedEntries(adapterConfig);
    }
  });

  const scanned = (await Promise.all(promises)).flatMap((entries) => entries ?? []);

  const results = await oneWriteAtATime(async () => {
    // Read again right before the write, another refresh may have saved in the meantime.
    const entries = partial ? keepUnlisted(storageAdapters, listed, scanned, await readStorageCache() ?? []) : scanned;
    await saveStorageCache(entries);
    return entries;
  });

  // Save historical snapshots for storage usage over time charts, of the destinations just listed
  await saveStorageSnapshots(scanned);

  // The dashboard overview caches its storage cards and trends, which this refresh just changed.
  invalidateDashboardCache();

  log.info("Storage statistics cache refreshed", {
    destinations: results.length,
    listed: listed.length,
    totalSize: results.reduce((sum, r) => sum + r.size, 0),
    totalFiles: results.reduce((sum, r) => sum + r.count, 0),
  });

  return results;
}

/**
 * The cache after a refresh of some destinations: the fresh values of the listed ones and the
 * cached values of the others, in the order of the destinations. A deleted destination drops out.
 */
function keepUnlisted(
  destinations: { id: string }[],
  listed: { id: string }[],
  scanned: StorageVolumeEntry[],
  cached: StorageVolumeEntry[],
): StorageVolumeEntry[] {
  const listedIds = new Set(listed.map((destination) => destination.id));
  return destinations.flatMap((destination) =>
    (listedIds.has(destination.id) ? scanned : cached).filter((entry) => entry.configId === destination.id));
}

/**
 * The values of a destination's last successful scan, from its newest storage snapshot.
 *
 * Snapshots are only written for successful scans, so this is what the destination held when it
 * was last reachable. A sum over the run history would count backups that retention deleted long
 * ago. A destination without any snapshot reports zero and no scan date.
 */
async function lastScannedEntry(adapterConfig: { id: string; name: string; adapterId: string }, tenantId: string): Promise<StorageVolumeEntry> {
  const snapshot = await prisma.storageSnapshot.findFirst({
    where: { adapterConfigId: adapterConfig.id, tenantId },
    orderBy: { createdAt: "desc" },
    select: { size: true, count: true, createdAt: true },
  });

  return {
    configId: adapterConfig.id,
    tenantId,
    name: adapterConfig.name,
    adapterId: adapterConfig.adapterId,
    size: snapshot ? Number(snapshot.size) : 0,
    count: snapshot?.count ?? 0,
    scanError: true,
    lastScanAt: snapshot?.createdAt.toISOString() ?? null,
  };
}

/** The last scan of a destination for its tenant and for every customer measured on it before. */
async function lastScannedEntries(adapterConfig: { id: string; name: string; adapterId: string; tenantId: string }): Promise<StorageVolumeEntry[]> {
  const measured = await prisma.storageSnapshot.findMany({ where: { adapterConfigId: adapterConfig.id }, select: { tenantId: true }, distinct: ["tenantId"] });
  const tenants = new Set([adapterConfig.tenantId, ...measured.map((row) => row.tenantId)]);
  return Promise.all([...tenants].map((tenantId) => lastScannedEntry(adapterConfig, tenantId)));
}

/** Used when no cache exists yet and the live refresh failed as a whole. */
async function getLastScannedStorageVolume(): Promise<StorageVolumeEntry[]> {
  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
  });
  return Promise.all(storageAdapters.map((config) => lastScannedEntry(config, config.tenantId)));
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
      size: exec.size != null ? Number(exec.size) : null,
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
    // Skip entries whose scan failed. They repeat the values of an earlier scan, and storing them
    // as a new measurement would fake a flat history and hide spikes from the alerts.
    const validEntries = entries.filter((entry) => entry.configId && !entry.scanError);

    if (validEntries.length < entries.length) {
      const skipped = entries.filter((e) => e.scanError).map((e) => e.name);
      log.warn("Skipping snapshots for adapters with scan errors", { skipped });
    }

    // A snapshot belongs to the tenant whose backups it counts, the tenant of its destination or a
    // customer of a shared one, also when the system task measures them all.
    const owners = new Map(
      (await prisma.adapterConfig.findMany({ where: { id: { in: validEntries.map((entry) => entry.configId!) } }, select: { id: true, tenantId: true } }))
        .map((config) => [config.id, config.tenantId])
    );
    // A destination deleted during the refresh drops out here, from the snapshots and the alerts.
    const owned = validEntries.filter((entry) => owners.has(entry.configId!));
    // One time for every snapshot of the refresh, so the snapshots of the tenants on one destination
    // read back as one measurement, for the history of All tenants and the usage spike.
    const measuredAt = new Date();
    const data = owned.map((entry) => ({
      tenantId: entry.tenantId ?? owners.get(entry.configId!)!,
      adapterConfigId: entry.configId!,
      adapterName: entry.name,
      adapterId: entry.adapterId,
      size: BigInt(Math.round(entry.size)),
      count: entry.count,
      createdAt: measuredAt,
    }));

    if (data.length === 0) return;

    await prisma.storageSnapshot.createMany({ data });

    log.debug("Saved storage snapshots", { count: data.length });

    // Check storage alert conditions only for entries with valid live scan data
    try {
      // The alerts of a destination are its tenant's. The storage limit and the usage spike watch all
      // it holds, the backups of the customers on a shared one too, which fill the same storage. The
      // missing backup alert watches the backups of its own tenant, named by the entry.
      await checkStorageAlerts(destinationTotals(owned, owners));
    } catch (alertError) {
      log.warn("Failed to check storage alerts", {}, wrapError(alertError));
    }
  } catch (error) {
    log.warn("Failed to save storage snapshots", {}, wrapError(error));
  }
}

/**
 * What a destination held over the last `days`, oldest first, for the storage history of the
 * dashboard and of a destination on the Backups page.
 *
 * A tenant sees its own backups on it, also on a destination another tenant shares with it, never
 * those of the tenant that shares it or of another customer. All tenants and the system scope see
 * everything the destination held: one point per refresh with the backups of every tenant summed,
 * like the one entry per destination of `getStorageVolume`.
 */
export async function getStorageHistory(
  configId: string,
  days: number = 30
): Promise<StorageSnapshotEntry[]> {
  const since = subDays(new Date(), days);
  const tenantId = await currentTenantId();

  const snapshots = await prisma.storageSnapshot.findMany({
    where: {
      adapterConfigId: configId,
      createdAt: { gte: since },
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      size: true,
      count: true,
      createdAt: true,
    },
  });

  const points = tenantId ? snapshots.map((snapshot) => [snapshot]) : perRefresh(snapshots);
  return points.map((point) => ({
    date: point[0].createdAt.toISOString(),
    size: point.reduce((sum, snapshot) => sum + Number(snapshot.size), 0),
    count: point.reduce((sum, snapshot) => sum + snapshot.count, 0),
  }));
}

/**
 * The snapshots of one destination, oldest first, grouped by the refresh that wrote them. A refresh
 * writes one snapshot for each tenant whose backups the destination holds, all with one time.
 */
function perRefresh<T extends { createdAt: Date }>(snapshots: T[]): T[][] {
  const refreshes: T[][] = [];
  for (const snapshot of snapshots) {
    const last = refreshes[refreshes.length - 1];
    if (last && last[0].createdAt.getTime() === snapshot.createdAt.getTime()) last.push(snapshot);
    else refreshes.push([snapshot]);
  }
  return refreshes;
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
