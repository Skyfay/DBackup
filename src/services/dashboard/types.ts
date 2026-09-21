import type { ActivityDataPoint, LatestJobEntry, StorageVolumeEntry } from "@/services/dashboard-service";

/** One execution of a job, as the dashboard lists and colors it. Dates are ISO strings. */
export interface RunSummary {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
}

/** A job whose most recent finished run failed or finished partially. */
export interface UnhealthyJob {
    jobId: string;
    jobName: string;
    /** The run that put the job into this state, for "View logs". */
    executionId: string;
    failedAt: string;
    /** Failed or partial runs among the recent runs the dashboard keeps per job. */
    badRuns: number;
    recentRuns: number;
    lastSuccessAt: string | null;
    /** Last error line of that run's log. Null when the log is gone or holds no error. */
    error: string | null;
}

export type DashboardHealth =
    | { state: "empty" }
    | {
        state: "healthy";
        lastRunAt: string | null;
        nextRun: { jobName: string; at: string } | null;
    }
    | {
        state: "failing" | "degraded";
        jobs: UnhealthyJob[];
    };

export interface DashboardKpis {
    successRate: {
        /** Percentage over the last 30 days, null when nothing finished in that window. */
        value: number | null;
        previous: number | null;
        /** One value per day of the activity window, null for days without finished runs. */
        trend: (number | null)[];
    };
    backupsStored: {
        value: number;
        weekAgo: number | null;
        destinations: number;
        trend: (number | null)[];
    };
    storageUsed: {
        /** Bytes. */
        value: number;
        weekAgo: number | null;
        trend: (number | null)[];
    };
    failedRuns24h: {
        value: number;
        total: number;
        lastFailureAt: string | null;
        trend: number[];
    };
}

export interface DashboardStrip {
    totalJobs: number;
    activeSchedules: number;
    succeeded24h: number;
    runningNow: number;
    queuedNow: number;
    avgDurationMs: number | null;
}

export interface DashboardJobRow {
    id: string;
    name: string;
    enabled: boolean;
    /** "PostgreSQL", "Directory", or both joined with a plus. */
    sourceLabel: string;
    /** First destination, with "+n" for the rest. */
    destinationLabel: string;
    /** Running or Pending while a run is live, otherwise the status of the last finished run. Null before the first run. */
    status: string | null;
    /** Oldest first, the live run included. */
    runs: RunSummary[];
    lastRun: RunSummary | null;
    nextRunAt: string | null;
}

export interface CalendarDay {
    /** yyyy-MM-dd in the scheduler timezone. */
    date: string;
    total: number;
    completed: number;
    failed: number;
    partial: number;
}

export interface DashboardOverview {
    health: DashboardHealth;
    kpis: DashboardKpis;
    strip: DashboardStrip;
    activity: ActivityDataPoint[];
    latestExecutions: LatestJobEntry[];
    jobs: { rows: DashboardJobRow[]; total: number };
    destinations: { entries: StorageVolumeEntry[]; updatedAt: string | null };
    calendar: { days: CalendarDay[]; today: string };
}
