import prisma from "@/lib/prisma";
import { WHOLE_JOB_RUNS } from "@/services/history/whole-runs";
import { newestBackupIds, readInChunks } from "@/services/history/newest-runs";
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
import { currentTenantId } from "@/lib/tenant/current";
import { successShare } from "@/lib/core/success-share";
import { dailyStorageTotals, dayBuckets, type SnapshotPoint } from "./trends";
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

/** The time zone the scheduler reads cron expressions in, UTC unless the settings name another. */
export async function getSchedulerTimezone(): Promise<string> {
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

/** How many runs the queue takes at once, from the maxConcurrentJobs setting. */
export async function getMaxConcurrentJobs(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const value = setting ? parseInt(setting.value, 10) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
}

async function loadRunStats(now: Date) {
    const since24h = subHours(now, 24);
    const since30d = subDays(now, 30);
    const since60d = subDays(now, 60);

    const [success30d, partial30d, failed30d, successPrev, partialPrev, failedPrev, succeeded24h, failed24h, total24h, backedUp, lastFailure, recentSuccesses] =
        await Promise.all([
            prisma.execution.count({ where: { status: "Success", startedAt: { gte: since30d } } }),
            prisma.execution.count({ where: { status: "Partial", startedAt: { gte: since30d } } }),
            prisma.execution.count({ where: { status: "Failed", startedAt: { gte: since30d } } }),
            prisma.execution.count({ where: { status: "Success", startedAt: { gte: since60d, lt: since30d } } }),
            prisma.execution.count({ where: { status: "Partial", startedAt: { gte: since60d, lt: since30d } } }),
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
                where: { type: "Backup", status: "Success", endedAt: { not: null }, AND: [WHOLE_JOB_RUNS] },
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
            value: successShare({ succeeded: success30d, partial: partial30d, failed: failed30d }),
            previous: successShare({ succeeded: successPrev, partial: partialPrev, failed: failedPrev }),
        },
        succeeded24h,
        failed24h,
        total24h,
        backedUp24h: Number(backedUp._sum.size ?? 0),
        lastFailureAt: lastFailure?.startedAt.toISOString() ?? null,
        avgDurationMs,
    };
}

/**
 * The ids of the newest snapshot of each destination and tenant in each span. A refresh writes one
 * snapshot per destination for each tenant whose backups it holds, so on a destination its tenant
 * shares with customers the newest of the span may belong to any of them, and each tenant is
 * picked on its own. With `tenantId` only the snapshots of that tenant, otherwise of every tenant
 * a destination held backups of in the window.
 *
 * Raw SQL for a measured reason: a busy instance holds hundreds of thousands of snapshots for 30
 * days, and loading them all took the overview 1.7 s, plus as long again to sort them into days.
 * One lookup per destination, tenant and day on the index of destination and time reads a few
 * rows each. `createdAt` is stored in epoch milliseconds, as Prisma writes every DateTime in SQLite.
 * The raw query skips the tenant filter, so it only picks ids and names the tenant itself.
 */
function pickNewestPerDay(destinations: string, days: string, windowStart: number, tenantId: string | null) {
    if (tenantId) {
        return prisma.$queryRaw<{ id: string | null }[]>`
            SELECT (
                SELECT s.id FROM StorageSnapshot s
                WHERE s.adapterConfigId = d.value
                  AND s.tenantId = ${tenantId}
                  AND s.createdAt >= json_extract(b.value, '$[0]')
                  AND s.createdAt < json_extract(b.value, '$[1]')
                ORDER BY s.createdAt DESC
                LIMIT 1
            ) AS id
            FROM json_each(${destinations}) d, json_each(${days}) b`;
    }
    // Every tenant measured on a destination in the window, the tenant of the destination and the
    // customers of a shared one.
    return prisma.$queryRaw<{ id: string | null }[]>`
        WITH holders AS (
            SELECT DISTINCT s.adapterConfigId AS configId, s.tenantId AS tenantId
            FROM StorageSnapshot s, json_each(${destinations}) d
            WHERE s.adapterConfigId = d.value AND s.createdAt >= ${windowStart}
        )
        SELECT (
            SELECT s.id FROM StorageSnapshot s
            WHERE s.adapterConfigId = h.configId
              AND s.tenantId = h.tenantId
              AND s.createdAt >= json_extract(b.value, '$[0]')
              AND s.createdAt < json_extract(b.value, '$[1]')
            ORDER BY s.createdAt DESC
            LIMIT 1
        ) AS id
        FROM holders h, json_each(${days}) b`;
}

/**
 * The newest snapshot of each destination and tenant in each span, oldest first, with the
 * destination and tenant as the key `dailyStorageTotals` sums by. They are the only ones it keeps,
 * so its totals stay the same as over every snapshot.
 *
 * A tenant sees its own backups, on its own destinations and on those other tenants share with it,
 * never what the tenant of a shared destination or another customer keeps there. All tenants sees
 * what each destination holds, the backups of every tenant on it summed per day.
 */
async function latestSnapshotPerDay(destinationIds: string[], buckets: [number, number][], tenantId: string | null): Promise<SnapshotPoint[]> {
    if (destinationIds.length === 0 || buckets.length === 0) return [];

    const picked = await pickNewestPerDay(JSON.stringify(destinationIds), JSON.stringify(buckets), buckets[0][0], tenantId);
    const ids = picked.map((row) => row.id).filter((id): id is string => id !== null);
    if (ids.length === 0) return [];

    // Read through the client, whose tenant filter keeps the snapshots of other tenants out of a tenant.
    const snapshots = await prisma.storageSnapshot.findMany({
        where: { id: { in: ids }, ...(tenantId ? { tenantId } : {}) },
        orderBy: { createdAt: "asc" },
        select: { adapterConfigId: true, tenantId: true, size: true, count: true, createdAt: true },
    });
    return snapshots.map(({ tenantId: holder, ...snapshot }) => ({ ...snapshot, adapterConfigId: holderKey(snapshot.adapterConfigId, holder) }));
}

/** The key of what one destination holds for one tenant. */
function holderKey(configId: string, tenantId: string): string {
    return `${configId}\n${tenantId}`;
}

async function loadStorage(timezone: string, now: Date): Promise<Aggregates["storage"]> {
    const [entries, updatedAt, tenantId] = await Promise.all([getStorageVolume(), getStorageVolumeCacheAge(), currentTenantId()]);

    const dayKeys = Array.from({ length: STORAGE_TREND_DAYS }, (_, i) =>
        dayKey(subDays(now, STORAGE_TREND_DAYS - 1 - i), timezone));
    // The destinations the scope sees now. A deleted one would inflate the totals.
    const destinationIds = [...new Set(entries.map((entry) => entry.configId).filter((id): id is string => !!id))];
    const buckets = dayBuckets(dayKeys, subDays(now, STORAGE_TREND_DAYS).getTime(),
        (day) => fromZonedTime(`${day}T00:00:00`, timezone).getTime());
    const snapshots = await latestSnapshotPerDay(destinationIds, buckets, tenantId);
    const holders = new Set(snapshots.map((snapshot) => snapshot.adapterConfigId));
    const totals = dailyStorageTotals(snapshots, dayKeys, (date) => dayKey(date, timezone), holders);

    return { entries, updatedAt, ...totals };
}

/**
 * The latest backup runs of every job, newest first. Shared by the dashboard and the Jobs page
 * and cleared with the rest of the cache when a backup finishes.
 */
export function getRecentRunsByJob(): Promise<Record<string, RunSummary[]>> {
    return cached("runs-by-job", AGGREGATES_TTL_MS, loadRunsByJob);
}

async function loadRunsByJob(): Promise<Record<string, RunSummary[]>> {
    const jobs = await prisma.job.findMany({ select: { id: true } });
    // One indexed lookup per job in one query keeps the cost flat no matter how long the history
    // is. The runs of the whole job: a run of single databases says nothing of its length or its health.
    const ids = await newestBackupIds(jobs.map((job) => job.id), { take: RUNS_PER_JOB, wholeJob: true });
    const runs = await readInChunks(ids, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true },
    }));
    runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const byJob: Record<string, RunSummary[]> = Object.fromEntries(jobs.map((job) => [job.id, []]));
    for (const run of runs) {
        if (run.jobId) byJob[run.jobId]?.push(toRunSummary(run));
    }
    return byJob;
}

async function loadAggregates(): Promise<Aggregates> {
    const now = new Date();
    const timezone = await getSchedulerTimezone();
    const [activity, calendar, runStats, storage, runsByJob, maxConcurrentJobs] = await Promise.all([
        loadActivity(timezone, now),
        loadCalendar(timezone, now),
        loadRunStats(now),
        loadStorage(timezone, now),
        getRecentRunsByJob(),
        getMaxConcurrentJobs(),
    ]);
    return { timezone, maxConcurrentJobs, activity, calendar, ...runStats, storage, runsByJob };
}

/** The history-based part of the dashboard, shared by every request until it expires or a backup finishes. */
export function getAggregates(): Promise<Aggregates> {
    return cached("aggregates", AGGREGATES_TTL_MS, loadAggregates);
}
