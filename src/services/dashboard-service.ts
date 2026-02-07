import prisma from "@/lib/prisma";
import { format, subDays, startOfDay } from "date-fns";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { registerAdapters } from "@/lib/adapters";

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
  name: string;
  adapterId: string;
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

/**
 * Fetches storage volume data by reading actual file sizes from each storage adapter.
 * This is more accurate than DB aggregation since it reflects the real storage usage
 * including compression and encryption overhead.
 */
export async function getStorageVolume(): Promise<StorageVolumeEntry[]> {
  registerAdapters();

  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage" },
  });

  if (storageAdapters.length === 0) return [];

  const results: StorageVolumeEntry[] = [];

  for (const adapterConfig of storageAdapters) {
    try {
      const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
      if (!adapter) continue;

      const config = decryptConfig(JSON.parse(adapterConfig.config));
      const files = await adapter.list(config, "");

      // Filter out .meta.json sidecar files (they are not backup data)
      const backupFiles = files.filter((f) => !f.name.endsWith(".meta.json"));

      const totalSize = backupFiles.reduce((sum, f) => sum + (f.size || 0), 0);

      results.push({
        name: adapterConfig.name,
        adapterId: adapterConfig.adapterId,
        size: totalSize,
        count: backupFiles.length,
      });
    } catch {
      // If adapter is unreachable, fall back to DB aggregation for this adapter
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
  }

  return results;
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
