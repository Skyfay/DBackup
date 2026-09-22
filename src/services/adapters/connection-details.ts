/**
 * Everything the details panel of one connection shows beyond its row: which jobs and
 * templates use it and how their last backup went, when a health check last passed, and
 * the server versions seen over time.
 */

import prisma from "@/lib/prisma";
import { HEALTH_HOURS, latestRunPerJob, type FinishedRun } from "./connection-overview";

/** How a job uses the connection. */
export type ConnectionRole = "source" | "destination" | "directory" | "notification";

export interface ConnectionUsage {
    jobs: { id: string; name: string; enabled: boolean; role: ConnectionRole; lastRun: FinishedRun | null }[];
    templates: { id: string; name: string }[];
}

export interface ConnectionDetails {
    /** Null when the caller may not see jobs. The counts in the list stay available. */
    usage: ConnectionUsage | null;
    /** The newest health check that passed, however long ago. */
    lastPassedAt: string | null;
    /** Mean response time of the checks that passed in the last day. */
    averageLatencyMs: number | null;
    /** Server versions seen by the version check, newest first. */
    versions: { version: string; previous: string | null; at: string }[];
}

const HOUR_MS = 60 * 60 * 1000;
const VERSIONS_SHOWN = 3;

export async function getConnectionDetails(id: string, options: { includeUsage: boolean }): Promise<ConnectionDetails> {
    const since = new Date(Date.now() - HEALTH_HOURS * HOUR_MS);

    const [latency, lastPassed, versions, usage] = await Promise.all([
        prisma.healthCheckLog.aggregate({
            where: { adapterConfigId: id, status: "ONLINE", createdAt: { gte: since } },
            _avg: { latencyMs: true },
        }),
        prisma.healthCheckLog.findFirst({
            where: { adapterConfigId: id, status: "ONLINE" },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        }),
        prisma.dbVersionHistory.findMany({
            where: { adapterConfigId: id },
            orderBy: { detectedAt: "desc" },
            take: VERSIONS_SHOWN,
            select: { newVersion: true, previousVersion: true, detectedAt: true },
        }),
        options.includeUsage ? loadUsage(id) : Promise.resolve(null),
    ]);

    const average = latency._avg.latencyMs;
    return {
        usage,
        lastPassedAt: lastPassed?.createdAt.toISOString() ?? null,
        averageLatencyMs: average === null ? null : Math.round(average),
        versions: versions.map((entry) => ({
            version: entry.newVersion,
            previous: entry.previousVersion,
            at: entry.detectedAt.toISOString(),
        })),
    };
}

async function loadUsage(id: string): Promise<ConnectionUsage> {
    const job = { select: { id: true, name: true, enabled: true } } as const;
    const [asSource, asDestination, asDirectory, notifying, channels] = await Promise.all([
        prisma.job.findMany({ where: { sourceId: id }, select: job.select }),
        prisma.jobDestination.findMany({ where: { configId: id }, select: { job } }),
        prisma.jobSource.findMany({ where: { configId: id }, select: { job } }),
        prisma.job.findMany({ where: { notifications: { some: { id } } }, select: job.select }),
        prisma.notificationTemplateChannel.findMany({ where: { configId: id }, select: { template: { select: { id: true, name: true } } } }),
    ]);

    // A directory source can feed several folders into one job. It is still one job.
    const jobs = new Map<string, { id: string; name: string; enabled: boolean; role: ConnectionRole }>();
    const add = (entry: { id: string; name: string; enabled: boolean }, role: ConnectionRole) => {
        if (!jobs.has(entry.id)) jobs.set(entry.id, { ...entry, role });
    };
    for (const entry of asSource) add(entry, "source");
    for (const link of asDestination) add(link.job, "destination");
    for (const link of asDirectory) add(link.job, "directory");
    for (const entry of notifying) add(entry, "notification");

    const lastRuns = await latestRunPerJob([...jobs.keys()]);
    return {
        jobs: [...jobs.values()]
            .map((entry) => ({ ...entry, lastRun: lastRuns.get(entry.id) ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        templates: channels.map((channel) => channel.template).sort((a, b) => a.name.localeCompare(b.name)),
    };
}
