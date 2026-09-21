import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { Cron } from "croner";
import { formatInTimeZone } from "date-fns-tz";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { getLatestJobs, type ActivityDataPoint } from "@/services/dashboard-service";
import { AGGREGATES_TTL_MS, RUNS_PER_JOB, getAggregates, toRunSummary } from "./aggregates";
import { cached } from "./cache";
import { deriveHealth, extractLastError, latestFinishedRun, mergeRuns } from "./health";
import { failedTrend, successRateTrend, valueDaysAgo } from "./trends";
import type { DashboardHealth, DashboardJobRow, DashboardOverview, RunSummary } from "./types";

const JOB_ROWS = 8;
const LATEST_EXECUTIONS = 12;

const ADAPTER_NAMES = new Map(ADAPTER_DEFINITIONS.map((definition) => [definition.id, definition.name]));

const jobSelect = {
    id: true,
    name: true,
    enabled: true,
    schedule: true,
    schedulePreset: { select: { schedule: true } },
    source: { select: { adapterId: true } },
    sources: { select: { id: true } },
    destinations: { select: { config: { select: { name: true } } }, orderBy: { priority: "asc" } },
} satisfies Prisma.JobSelect;

type OverviewJob = Prisma.JobGetPayload<{ select: typeof jobSelect }>;

function effectiveSchedule(job: OverviewJob): string {
    return (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
}

function nextRunAt(job: OverviewJob, timezone: string): string | null {
    const schedule = effectiveSchedule(job);
    if (!job.enabled || !schedule) return null;
    try {
        return new Cron(schedule, { timezone }).nextRun()?.toISOString() ?? null;
    } catch {
        // An invalid expression never runs, so there is no next run to show.
        return null;
    }
}

function describeSource(job: OverviewJob): string {
    const parts: string[] = [];
    if (job.source) parts.push(ADAPTER_NAMES.get(job.source.adapterId) ?? job.source.adapterId);
    if (job.sources.length > 0) parts.push("Directory");
    return parts.length > 0 ? parts.join(" + ") : "No source";
}

function describeDestinations(job: OverviewJob): string {
    const [first, ...rest] = job.destinations;
    if (!first) return "No destination";
    return rest.length > 0 ? `${first.config.name} +${rest.length}` : first.config.name;
}

/** Live runs first, then the next scheduled run, then the name. */
function compareRows(a: DashboardJobRow, b: DashboardJobRow): number {
    const rank = (row: DashboardJobRow) => (row.status === "Running" ? 0 : row.status === "Pending" ? 1 : 2);
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.nextRunAt && b.nextRunAt && a.nextRunAt !== b.nextRunAt) return a.nextRunAt.localeCompare(b.nextRunAt);
    if (a.nextRunAt && !b.nextRunAt) return -1;
    if (!a.nextRunAt && b.nextRunAt) return 1;
    return a.name.localeCompare(b.name);
}

/**
 * The cached activity counts in-progress runs as they were when it was filled.
 * Those counts are replaced by the live ones so a started run shows up right away.
 */
function withLiveActivity(activity: ActivityDataPoint[], liveRuns: RunSummary[], timezone: string): ActivityDataPoint[] {
    const days = activity.map((day) => ({ ...day, running: 0, pending: 0 }));
    const byDate = new Map(days.map((day) => [day.date, day]));
    for (const run of liveRuns) {
        const day = byDate.get(formatInTimeZone(new Date(run.startedAt), timezone, "MMM d"));
        if (!day) continue;
        if (run.status === "Running") day.running++;
        else day.pending++;
    }
    return days;
}

/** Adds the error line and last clean run to the job the banner features. Cached per failed run. */
async function withFailureDetails(health: DashboardHealth): Promise<DashboardHealth> {
    if (health.state !== "failing" && health.state !== "degraded") return health;

    const [featured, ...rest] = health.jobs;
    const details = await cached(`failure:${featured.executionId}`, AGGREGATES_TTL_MS, async () => {
        const [execution, lastSuccess] = await Promise.all([
            prisma.execution.findUnique({ where: { id: featured.executionId }, select: { logs: true } }),
            featured.lastSuccessAt
                ? null
                : prisma.execution.findFirst({
                    where: { jobId: featured.jobId, type: "Backup", status: "Success" },
                    orderBy: { startedAt: "desc" },
                    select: { startedAt: true },
                }),
        ]);
        return {
            error: extractLastError(execution?.logs),
            lastSuccessAt: featured.lastSuccessAt ?? lastSuccess?.startedAt.toISOString() ?? null,
        };
    });

    return { ...health, jobs: [{ ...featured, ...details }, ...rest] };
}

/**
 * Everything the dashboard overview shows.
 *
 * Aggregates over days of history come from a cache that a finished backup clears. Running
 * executions, the latest executions and the job list are read live on every call, so the page
 * can poll while a job runs without recomputing the history each time.
 */
export async function getDashboardOverview(): Promise<DashboardOverview> {
    const [aggregates, jobs, liveExecutions, latestExecutions] = await Promise.all([
        getAggregates(),
        prisma.job.findMany({ select: jobSelect, orderBy: { name: "asc" } }),
        prisma.execution.findMany({
            where: { status: { in: ["Running", "Pending"] } },
            orderBy: { startedAt: "desc" },
            select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true },
        }),
        getLatestJobs(LATEST_EXECUTIONS),
    ]);

    const liveRuns = liveExecutions.map(toRunSummary);
    const liveByJob = new Map<string, RunSummary[]>();
    liveExecutions.forEach((execution, index) => {
        if (!execution.jobId) return;
        const list = liveByJob.get(execution.jobId) ?? [];
        list.push(liveRuns[index]);
        liveByJob.set(execution.jobId, list);
    });

    const runsByJob = new Map<string, RunSummary[]>();
    const rows: DashboardJobRow[] = jobs.map((job) => {
        const live = liveByJob.get(job.id) ?? [];
        const runs = mergeRuns(aggregates.runsByJob[job.id] ?? [], live, RUNS_PER_JOB);
        runsByJob.set(job.id, runs);
        const liveStatus = live.find((run) => run.status === "Running")?.status ?? live[0]?.status;
        return {
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            sourceLabel: describeSource(job),
            destinationLabel: describeDestinations(job),
            status: liveStatus ?? latestFinishedRun(runs)?.status ?? null,
            runs: [...runs].reverse(),
            lastRun: runs[0] ?? null,
            nextRunAt: nextRunAt(job, aggregates.timezone),
        };
    });
    rows.sort(compareRows);

    const health = await withFailureDetails(deriveHealth(rows, runsByJob));
    const activity = withLiveActivity(aggregates.activity, liveRuns, aggregates.timezone);
    const { storage } = aggregates;

    return {
        health,
        kpis: {
            successRate: { ...aggregates.successRate, trend: successRateTrend(activity) },
            backupsStored: {
                value: storage.entries.reduce((sum, entry) => sum + entry.count, 0),
                weekAgo: valueDaysAgo(storage.count, 7),
                destinations: storage.entries.length,
                trend: storage.count,
            },
            storageUsed: {
                value: storage.entries.reduce((sum, entry) => sum + entry.size, 0),
                weekAgo: valueDaysAgo(storage.size, 7),
                trend: storage.size,
            },
            failedRuns24h: {
                value: aggregates.failed24h,
                total: aggregates.total24h,
                lastFailureAt: aggregates.lastFailureAt,
                trend: failedTrend(activity),
            },
        },
        strip: {
            totalJobs: jobs.length,
            activeSchedules: jobs.filter((job) => job.enabled && effectiveSchedule(job)).length,
            succeeded24h: aggregates.succeeded24h,
            runningNow: liveRuns.filter((run) => run.status === "Running").length,
            queuedNow: liveRuns.filter((run) => run.status === "Pending").length,
            avgDurationMs: aggregates.avgDurationMs,
        },
        activity,
        latestExecutions,
        jobs: { rows: rows.slice(0, JOB_ROWS), total: jobs.length },
        destinations: { entries: storage.entries, updatedAt: storage.updatedAt },
        calendar: aggregates.calendar,
    };
}
