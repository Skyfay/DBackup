import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { Cron } from "croner";
import { formatInTimeZone } from "date-fns-tz";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { getLatestJobs, type ActivityDataPoint } from "@/services/dashboard-service";
import { AGGREGATES_TTL_MS, RUNS_PER_JOB, getAggregates, toRunSummary } from "./aggregates";
import { cached } from "./cache";
import { deriveHealth, extractLastError, latestFinishedRun, mergeRuns } from "./health";
import { buildUpcomingSchedule, type ScheduledJob } from "./schedule";
import { failedTrend, successRateTrend, valueDaysAgo } from "./trends";
import type { DashboardHealth, DashboardJobRow, DashboardOverview, RunSummary, UnhealthyJob, UpcomingJob, UpcomingSchedule } from "./types";
import { isAirGapped } from "@/lib/core/air-gap";
import { OTHER_TENANT_JOB, OTHER_TENANT_JOB_NAME } from "@/services/jobs/job-timeline-types";
import { NO_OTHER_TENANTS, otherTenantQueue, queueViewer, type OtherTenantJob } from "@/services/jobs/other-tenant-queue";

/** A job of the Upcoming card with its tenant, which All tenants names. */
export interface UpcomingTenantJob extends UpcomingJob {
    tenantId: string;
}

export interface OverviewUpcoming extends UpcomingSchedule {
    jobs: UpcomingTenantJob[];
}

/** The overview, with the tenant of every job the Upcoming card lists. */
export interface Overview extends DashboardOverview {
    upcoming: OverviewUpcoming;
}

const JOB_ROWS = 8;
/** Unhealthy jobs the banner shows with their own error and actions. */
const BANNER_JOBS = 3;
/** The KPI sparklines cover two weeks, whatever range the activity chart shows. */
const TREND_DAYS = 14;
const LATEST_EXECUTIONS = 12;
/** The adapter types the health check pings. Notification channels are not checked. */
const HEALTH_CHECKED_TYPES = ["database", "storage"];

const ADAPTER_NAMES = new Map(ADAPTER_DEFINITIONS.map((definition) => [definition.id, definition.name]));

const jobSelect = {
    id: true,
    name: true,
    // In All tenants the lists name the tenant of each job.
    tenantId: true,
    enabled: true,
    schedule: true,
    encryptionProfileId: true,
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

/** Adds the error line and last clean run to a job the banner lists. Cached per failed run. */
function withJobDetails(job: UnhealthyJob): Promise<UnhealthyJob> {
    return cached(`failure:${job.executionId}`, AGGREGATES_TTL_MS, async () => {
        const [execution, lastSuccess] = await Promise.all([
            prisma.execution.findUnique({ where: { id: job.executionId }, select: { logs: true } }),
            job.lastSuccessAt
                ? null
                : prisma.execution.findFirst({
                    where: { jobId: job.jobId, type: "Backup", status: "Success" },
                    orderBy: { startedAt: "desc" },
                    select: { startedAt: true },
                }),
        ]);
        return {
            ...job,
            error: extractLastError(execution?.logs),
            lastSuccessAt: job.lastSuccessAt ?? lastSuccess?.startedAt.toISOString() ?? null,
        };
    });
}

/**
 * The runs of the next 48 hours with where they queue up. The queue is one for every tenant, so in
 * a tenant the runs of the other tenants count toward an overlap, without being listed. Only an
 * overlap that a run of this tenant falls into is kept, the others say nothing about its runs.
 */
function upcomingOf(own: ScheduledJob[], runsByJob: Map<string, RunSummary[]>, failing: Set<string>, slots: number, timezone: string, now: Date, others: OtherTenantJob[]): UpcomingSchedule {
    const schedule = buildUpcomingSchedule(own, runsByJob, failing, slots, timezone, now);
    if (others.length === 0) return schedule;

    const anonymous = others.map((job, index) => ({ id: `${OTHER_TENANT_JOB}:${index + 1}`, name: OTHER_TENANT_JOB_NAME, schedule: job.schedule }));
    const otherRuns = new Map(anonymous.map((job, index) => [job.id, others[index].runs]));
    const shared = buildUpcomingSchedule([...own, ...anonymous], new Map([...runsByJob, ...otherRuns]), failing, slots, timezone, now);

    const lengths = new Map(schedule.jobs.map((job) => [job.id, job.estimatedMs]));
    const ownSpans = schedule.runs.map((run) => ({ from: Date.parse(run.at), to: Date.parse(run.at) + Math.max(lengths.get(run.jobId) ?? 0, 1) }));
    const conflicts = shared.conflicts.filter((conflict) => {
        const from = Date.parse(conflict.from);
        const to = Date.parse(conflict.to);
        return ownSpans.some((span) => span.from < to && span.to > from);
    });
    return { ...schedule, conflicts };
}

/** The banner gives each of the first few unhealthy jobs its own row, the rest are counted. */
async function withFailureDetails(health: DashboardHealth): Promise<DashboardHealth> {
    if (health.state !== "failing" && health.state !== "degraded") return health;

    const listed = await Promise.all(health.jobs.slice(0, BANNER_JOBS).map(withJobDetails));
    return { ...health, jobs: [...listed, ...health.jobs.slice(BANNER_JOBS)] };
}

/**
 * Everything the dashboard overview shows.
 *
 * Aggregates over days of history come from a cache that a finished backup clears. Running
 * executions, the latest executions and the job list are read live on every call, so the page
 * can poll while a job runs without recomputing the history each time.
 */
export async function getDashboardOverview(): Promise<Overview> {
    const viewer = await queueViewer();
    const [aggregates, jobs, liveExecutions, latestExecutions, connections, offlineConnections, others] = await Promise.all([
        getAggregates(),
        prisma.job.findMany({ select: jobSelect, orderBy: { name: "asc" } }),
        prisma.execution.findMany({
            where: { status: { in: ["Running", "Pending"] } },
            orderBy: { startedAt: "desc" },
            select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true },
        }),
        getLatestJobs(LATEST_EXECUTIONS),
        prisma.adapterConfig.count({ where: { type: { in: HEALTH_CHECKED_TYPES } } }),
        // An air-gapped destination that is not connected is away on purpose, so it is not counted.
        prisma.adapterConfig
            .findMany({ where: { type: { in: HEALTH_CHECKED_TYPES }, lastStatus: "OFFLINE" }, select: { type: true, storageRole: true, metadata: true } })
            .then((rows) => rows.filter((row) => !isAirGapped(row)).length),
        viewer ? otherTenantQueue(viewer) : NO_OTHER_TENANTS,
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
            tenantId: job.tenantId,
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
    const failingJobIds = new Set(health.state === "failing" ? health.jobs.map((job) => job.jobId) : []);
    const schedule = upcomingOf(
        jobs
            .filter((job) => job.enabled && effectiveSchedule(job))
            .map((job) => ({ id: job.id, name: job.name, schedule: effectiveSchedule(job) })),
        runsByJob,
        failingJobIds,
        aggregates.maxConcurrentJobs,
        aggregates.timezone,
        new Date(),
        others.jobs,
    );
    // In All tenants the card names the tenant of each job, like the other lists of the page.
    const tenantOf = new Map(jobs.map((job) => [job.id, job.tenantId]));
    const upcoming: OverviewUpcoming = { ...schedule, jobs: schedule.jobs.map((job) => ({ ...job, tenantId: tenantOf.get(job.id) ?? "" })) };
    const activity = withLiveActivity(aggregates.activity, liveRuns, aggregates.timezone);
    const { storage } = aggregates;

    return {
        health,
        kpis: {
            successRate: { ...aggregates.successRate, trend: successRateTrend(activity.slice(-TREND_DAYS)) },
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
                trend: failedTrend(activity.slice(-TREND_DAYS)),
            },
        },
        strip: {
            totalJobs: jobs.length,
            activeSchedules: jobs.filter((job) => job.enabled && effectiveSchedule(job)).length,
            encryptedJobs: jobs.filter((job) => job.encryptionProfileId).length,
            connections,
            offlineConnections,
            runningNow: liveRuns.filter((run) => run.status === "Running").length,
            queuedNow: liveRuns.filter((run) => run.status === "Pending").length,
            succeeded24h: aggregates.succeeded24h,
            backedUp24h: aggregates.backedUp24h,
            avgDurationMs: aggregates.avgDurationMs,
        },
        activity,
        latestExecutions,
        jobs: { rows: rows.slice(0, JOB_ROWS), total: jobs.length },
        destinations: { entries: storage.entries, updatedAt: storage.updatedAt },
        calendar: aggregates.calendar,
        upcoming,
    };
}
