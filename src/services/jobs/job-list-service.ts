import type { Prisma } from "@prisma/client";
import { subDays } from "date-fns";
import prisma from "@/lib/prisma";
import { getJobOverviews, type JobOverview } from "./job-overview";

/** What a list shows of a connection a job uses. Never its config, which holds hosts and secrets. */
const connectionFields = { id: true, name: true, adapterId: true, lastStatus: true } satisfies Prisma.AdapterConfigSelect;

const jobListSelect = {
    id: true,
    name: true,
    schedule: true,
    enabled: true,
    sourceId: true,
    databases: true,
    encryptionProfileId: true,
    compression: true,
    pgCompression: true,
    notificationEvents: true,
    namingTemplateId: true,
    schedulePresetId: true,
    skipVerification: true,
    backupMode: true,
    fullEveryDays: true,
    verifyByHash: true,
    createdAt: true,
    source: { select: connectionFields },
    destinations: {
        select: {
            configId: true,
            priority: true,
            retention: true,
            retentionPolicyId: true,
            retentionPolicy: { select: { name: true } },
            config: { select: connectionFields },
        },
        orderBy: { priority: "asc" },
    },
    sources: {
        select: {
            configId: true,
            priority: true,
            path: true,
            excludePatterns: true,
            stopContainers: true,
            excludePatternPresets: { select: { id: true } },
            config: { select: connectionFields },
        },
        orderBy: { priority: "asc" },
    },
    notifications: { select: { id: true, name: true, adapterId: true } },
    notificationTemplates: { select: { templateId: true, priority: true, template: { select: { name: true } } }, orderBy: { priority: "asc" } },
    encryptionProfile: { select: { id: true, name: true } },
    schedulePreset: { select: { id: true, name: true, schedule: true } },
    namingTemplate: { select: { id: true, name: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof jobListSelect }>;

export type JobListConnection = Prisma.AdapterConfigGetPayload<{ select: typeof connectionFields }>;

export type JobListItem = Omit<JobRow, "sources" | "createdAt"> & {
    createdAt: string;
    sources: (Omit<JobRow["sources"][number], "excludePatterns" | "excludePatternPresets"> & {
        excludePatterns: string[];
        excludePatternPresetIds: string[];
    })[];
    overview: JobOverview;
};

function parsePatterns(value: string): string[] {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/**
 * Every job with what the Jobs page shows and the form edits, plus how it is doing. The
 * connections it uses come with their name and type only, so reading jobs never reveals more
 * of a connection than the connection lists do.
 */
export async function getJobList(): Promise<JobListItem[]> {
    const jobs = await prisma.job.findMany({ select: jobListSelect, orderBy: { createdAt: "desc" } });
    const overviews = await getJobOverviews(jobs);

    return jobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
        sources: job.sources.map(({ excludePatterns, excludePatternPresets, ...source }) => ({
            ...source,
            excludePatterns: parsePatterns(excludePatterns),
            excludePatternPresetIds: excludePatternPresets.map((preset) => preset.id),
        })),
        overview: overviews.get(job.id) ?? { status: null, runs: [], lastRun: null, error: null, live: null, nextRunAt: null },
    }));
}

/** How many runs the details of a job show. */
export const RUN_HISTORY_SIZE = 30;
const SUCCESS_RATE_DAYS = 30;

export interface JobRunEntry {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    /** Bytes stored, for a run that stored something. */
    size: number | null;
}

export interface JobRunHistory {
    /** Oldest first. */
    runs: JobRunEntry[];
    /** Finished runs of the last 30 days and how many of them succeeded. */
    successRate: { succeeded: number; total: number };
    lastSuccess: { at: string; size: number | null } | null;
}

/** The latest runs of one job, for its details. */
export async function getJobRunHistory(jobId: string, now = new Date()): Promise<JobRunHistory> {
    const since = subDays(now, SUCCESS_RATE_DAYS);
    const [runs, outcomes, lastSuccess] = await Promise.all([
        prisma.execution.findMany({
            where: { jobId, type: "Backup" },
            orderBy: { startedAt: "desc" },
            take: RUN_HISTORY_SIZE,
            select: { id: true, status: true, startedAt: true, endedAt: true, size: true },
        }),
        prisma.execution.groupBy({
            by: ["status"],
            where: { jobId, type: "Backup", startedAt: { gte: since }, status: { in: ["Success", "Partial", "Failed"] } },
            _count: { _all: true },
        }),
        prisma.execution.findFirst({
            where: { jobId, type: "Backup", status: "Success" },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true, size: true },
        }),
    ]);

    const counts = new Map(outcomes.map((row) => [row.status, row._count._all]));
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

    return {
        runs: runs.reverse().map((run) => ({
            id: run.id,
            status: run.status,
            startedAt: run.startedAt.toISOString(),
            endedAt: run.endedAt?.toISOString() ?? null,
            size: run.size === null ? null : Number(run.size),
        })),
        successRate: { succeeded: counts.get("Success") ?? 0, total },
        lastSuccess: lastSuccess ? { at: lastSuccess.startedAt.toISOString(), size: lastSuccess.size === null ? null : Number(lastSuccess.size) } : null,
    };
}
