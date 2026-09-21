import prisma from "@/lib/prisma";
import { subDays, subHours } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
    getActivityData,
    getStorageVolume,
    getStorageVolumeCacheAge,
    type ActivityDataPoint,
    type StorageVolumeEntry,
} from "@/services/dashboard-service";
import { cached } from "./cache";
import { dailyStorageTotals, successPercentage } from "./trends";
import type { CalendarDay, RunSummary } from "./types";

/** How long the aggregates stay cached. A finished backup clears them earlier. */
export const AGGREGATES_TTL_MS = 60_000;
export const RUNS_PER_JOB = 12;
/** The activity chart switches between 14, 30 and 90 days, so the longest range is loaded. */
const ACTIVITY_DAYS = 90;
/** The calendar shows as many weeks as fit its width, up to a year. */
const CALENDAR_DAYS = 53 * 7;
/**
 * Past days of the calendar and the activity chart only change when data retention removes runs,
 * so they are cached for an hour and survive a finished backup. Only today's counts are part of
 * the short-lived aggregates.
 */
const HISTORY_TTL_MS = 60 * 60 * 1000;
const STORAGE_TREND_DAYS = 30;
/** The average duration covers this many recent successful backups, so its cost does not grow with history. */
const DURATION_SAMPLE = 100;

export interface Aggregates {
    timezone: string;
    /** Concurrent runs the queue allows, from the maxConcurrentJobs setting. */
    maxConcurrentJobs: number;
    /** One entry per day, oldest first, the last one is today. */
    activity: ActivityDataPoint[];
    calendar: { days: CalendarDay[]; today: string };
    successRate: { value: number | null; previous: number | null };
    succeeded24h: number;
    failed24h: number;
    total24h: number;
    backedUp24h: number;
    lastFailureAt: string | null;
    avgDurationMs: number | null;
    storage: {
        entries: StorageVolumeEntry[];
        updatedAt: string | null;
        size: (number | null)[];
        count: (number | null)[];
    };
    /** Recent backup runs per job id, newest first. */
    runsByJob: Record<string, RunSummary[]>;
}

export function toRunSummary(run: { id: string; status: string; startedAt: Date; endedAt: Date | null }): RunSummary {
    return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
    };
}

function dayKey(date: Date, timezone: string): string {
    return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

async function loadTimezone(): Promise<string> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
    return setting?.value || "UTC";
}

function emptyDay(date: string): CalendarDay {
    return { date, total: 0, completed: 0, failed: 0, partial: 0 };
}

function countDays(days: Map<string, CalendarDay>, executions: { startedAt: Date; status: string }[], timezone: string): void {
    for (const execution of executions) {
        const day = days.get(dayKey(execution.startedAt, timezone));
        if (!day) continue;
        day.total++;
        if (execution.status === "Success") day.completed++;
        else if (execution.status === "Failed") day.failed++;
        else if (execution.status === "Partial") day.partial++;
    }
}

async function loadCalendarHistory(timezone: string, today: string, startOfToday: Date, now: Date): Promise<CalendarDay[]> {
    // One extra day covers the offset between UTC and the scheduler timezone.
    const executions = await prisma.execution.findMany({
        where: { type: "Backup", startedAt: { gte: subDays(now, CALENDAR_DAYS + 1), lt: startOfToday } },
        select: { startedAt: true, status: true },
    });

    const days = new Map<string, CalendarDay>();
    for (let offset = CALENDAR_DAYS - 1; offset >= 1; offset--) {
        const date = dayKey(subDays(now, offset), timezone);
        if (date < today) days.set(date, emptyDay(date));
    }
    countDays(days, executions, timezone);
    return Array.from(days.values());
}

async function loadCalendar(timezone: string, now: Date): Promise<Aggregates["calendar"]> {
    const today = dayKey(now, timezone);
    const startOfToday = fromZonedTime(`${today}T00:00:00`, timezone);

    const [history, todaysRuns] = await Promise.all([
        cached(
            `calendar-history:${timezone}:${today}`,
            HISTORY_TTL_MS,
            () => loadCalendarHistory(timezone, today, startOfToday, now),
            { survivesInvalidation: true },
        ),
        prisma.execution.findMany({
            where: { type: "Backup", startedAt: { gte: startOfToday } },
            select: { startedAt: true, status: true },
        }),
    ]);

    const todayDays = new Map([[today, emptyDay(today)]]);
    countDays(todayDays, todaysRuns, timezone);
    return { days: [...history, todayDays.get(today)!], today };
}

function countActivity(date: string, executions: { status: string }[]): ActivityDataPoint {
    const point: ActivityDataPoint = { date, completed: 0, failed: 0, partial: 0, running: 0, pending: 0, cancelled: 0 };
    for (const { status } of executions) {
        if (status === "Success") point.completed++;
        else if (status === "Failed") point.failed++;
        else if (status === "Partial") point.partial++;
        else if (status === "Running") point.running++;
        else if (status === "Pending") point.pending++;
        else if (status === "Cancelled") point.cancelled++;
    }
    return point;
}

async function loadActivity(timezone: string, now: Date): Promise<ActivityDataPoint[]> {
    const today = dayKey(now, timezone);
    const startOfToday = fromZonedTime(`${today}T00:00:00`, timezone);

    const [history, todaysRuns] = await Promise.all([
        cached(`activity-history:${timezone}:${today}`, HISTORY_TTL_MS, () => getActivityData(ACTIVITY_DAYS), {
            survivesInvalidation: true,
        }),
        prisma.execution.findMany({ where: { startedAt: { gte: startOfToday } }, select: { status: true } }),
    ]);

    // The last cached day is today as it was when the cache was filled. It is replaced by live counts.
    return [...history.slice(0, -1), countActivity(formatInTimeZone(now, timezone, "MMM d"), todaysRuns)];
}

async function loadMaxConcurrentJobs(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const value = setting ? parseInt(setting.value, 10) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
}

async function loadRunStats(now: Date) {
    const since24h = subHours(now, 24);
    const since30d = subDays(now, 30);
    const since60d = subDays(now, 60);

    const [success30d, failed30d, successPrev, failedPrev, succeeded24h, failed24h, total24h, backedUp, lastFailure, recentSuccesses] =
        await Promise.all([
            prisma.execution.count({ where: { status: "Success", startedAt: { gte: since30d } } }),
            prisma.execution.count({ where: { status: "Failed", startedAt: { gte: since30d } } }),
            prisma.execution.count({ where: { status: "Success", startedAt: { gte: since60d, lt: since30d } } }),
            prisma.execution.count({ where: { status: "Failed", startedAt: { gte: since60d, lt: since30d } } }),
            prisma.execution.count({ where: { status: "Success", startedAt: { gte: since24h } } }),
            prisma.execution.count({ where: { status: "Failed", startedAt: { gte: since24h } } }),
            prisma.execution.count({ where: { startedAt: { gte: since24h } } }),
            // A partial run still stored its archive on at least one destination.
            prisma.execution.aggregate({
                where: { type: "Backup", status: { in: ["Success", "Partial"] }, startedAt: { gte: since24h } },
                _sum: { size: true },
            }),
            prisma.execution.findFirst({
                where: { status: "Failed" },
                orderBy: { startedAt: "desc" },
                select: { startedAt: true },
            }),
            prisma.execution.findMany({
                where: { type: "Backup", status: "Success", endedAt: { not: null } },
                orderBy: { startedAt: "desc" },
                take: DURATION_SAMPLE,
                select: { startedAt: true, endedAt: true },
            }),
        ]);

    const durations = recentSuccesses.map((run) => run.endedAt!.getTime() - run.startedAt.getTime());
    const avgDurationMs = durations.length > 0
        ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
        : null;

    return {
        successRate: {
            value: successPercentage(success30d, failed30d),
            previous: successPercentage(successPrev, failedPrev),
        },
        succeeded24h,
        failed24h,
        total24h,
        backedUp24h: Number(backedUp._sum.size ?? 0),
        lastFailureAt: lastFailure?.startedAt.toISOString() ?? null,
        avgDurationMs,
    };
}

async function loadStorage(timezone: string, now: Date): Promise<Aggregates["storage"]> {
    const [entries, updatedAt, snapshots] = await Promise.all([
        getStorageVolume(),
        getStorageVolumeCacheAge(),
        prisma.storageSnapshot.findMany({
            where: { createdAt: { gte: subDays(now, STORAGE_TREND_DAYS) } },
            orderBy: { createdAt: "asc" },
            select: { adapterConfigId: true, size: true, count: true, createdAt: true },
        }),
    ]);

    const dayKeys = Array.from({ length: STORAGE_TREND_DAYS }, (_, i) =>
        dayKey(subDays(now, STORAGE_TREND_DAYS - 1 - i), timezone));
    const destinationIds = new Set(entries.map((entry) => entry.configId).filter((id): id is string => !!id));
    const totals = dailyStorageTotals(snapshots, dayKeys, (date) => dayKey(date, timezone), destinationIds);

    return { entries, updatedAt, ...totals };
}

async function loadRunsByJob(): Promise<Record<string, RunSummary[]>> {
    const jobs = await prisma.job.findMany({ select: { id: true } });
    // One indexed lookup per job keeps the cost flat no matter how long the history is.
    const entries = await Promise.all(jobs.map(async (job) => {
        const runs = await prisma.execution.findMany({
            where: { jobId: job.id, type: "Backup" },
            orderBy: { startedAt: "desc" },
            take: RUNS_PER_JOB,
            select: { id: true, status: true, startedAt: true, endedAt: true },
        });
        return [job.id, runs.map(toRunSummary)] as const;
    }));
    return Object.fromEntries(entries);
}

async function loadAggregates(): Promise<Aggregates> {
    const now = new Date();
    const timezone = await loadTimezone();
    const [activity, calendar, runStats, storage, runsByJob, maxConcurrentJobs] = await Promise.all([
        loadActivity(timezone, now),
        loadCalendar(timezone, now),
        loadRunStats(now),
        loadStorage(timezone, now),
        loadRunsByJob(),
        loadMaxConcurrentJobs(),
    ]);
    return { timezone, maxConcurrentJobs, activity, calendar, ...runStats, storage, runsByJob };
}

/** The history-based part of the dashboard, shared by every request until it expires or a backup finishes. */
export function getAggregates(): Promise<Aggregates> {
    return cached("aggregates", AGGREGATES_TTL_MS, loadAggregates);
}
