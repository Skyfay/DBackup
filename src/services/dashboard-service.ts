import prisma from "@/lib/prisma";
import { format, subDays, startOfDay } from "date-fns";

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
    totalSnapshots,
    storageAgg,
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
      where: { status: "Success" },
    }),
    prisma.execution.aggregate({
      _sum: { size: true },
      where: { status: "Success" },
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

  const totalStorageBytes = Number(storageAgg._sum.size ?? 0);
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
 * Fetches storage volume data grouped by storage destination.
 * Used for the Storage by Volume horizontal bar chart.
 */
export async function getStorageVolume(): Promise<StorageVolumeEntry[]> {
  const storageAdapters = await prisma.adapterConfig.findMany({
    where: { type: "storage" },
  });

  if (storageAdapters.length === 0) return [];

  const executions = await prisma.execution.findMany({
    where: { status: "Success", size: { not: null } },
    select: {
      size: true,
      job: { select: { destinationId: true } },
    },
  });

  const stats = new Map<string, { size: number; count: number }>();
  storageAdapters.forEach((ad) => stats.set(ad.id, { size: 0, count: 0 }));

  for (const ex of executions) {
    if (ex.job?.destinationId && stats.has(ex.job.destinationId)) {
      const current = stats.get(ex.job.destinationId)!;
      current.size += Number(ex.size ?? 0);
      current.count++;
    }
  }

  return storageAdapters.map((adapter) => {
    const stat = stats.get(adapter.id) ?? { size: 0, count: 0 };
    return {
      name: adapter.name,
      adapterId: adapter.adapterId,
      size: stat.size,
      count: stat.count,
    };
  });
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
