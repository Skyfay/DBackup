/**
 * What the connection tables show next to the configuration: who uses a connection, how
 * its backups went, how its health checks went, and what it stores.
 *
 * Kept apart from the adapter list itself because every value here is an aggregate over
 * other tables. The list is polled every few seconds for its live status, while these
 * values change far more slowly and come from a short cache.
 */

import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { cached } from "@/services/dashboard/cache";
import { getStorageVolume } from "@/services/dashboard-service";

/** A finished backup, with the execution id to link it. */
export interface FinishedRun {
    id: string;
    at: string;
    status: string;
}

/** One hour of health checks: all passed, one failed, the connection went offline, or none ran. */
export type HealthBucket = "ok" | "failed" | "offline" | "none";

export interface ConnectionOverview {
    /** Jobs that use the connection in any role, and notification templates that send through it. */
    usedBy: { jobs: number; templates: number };
    /** The newest finished backup of those jobs. */
    lastBackup: FinishedRun | null;
    /** One bucket per hour of the last day, oldest first. */
    health: HealthBucket[];
    /** Share of passed health checks over the last day in percent, null when none ran. */
    checksPassed: number | null;
    /** Response time of the newest passed health check. */
    latencyMs: number | null;
    credentialName: string | null;
    /** Backup destinations only: the retention a new job starts with. */
    retentionName: string | null;
    /** Backup destinations only: size and backup count from the last storage scan. */
    stored: { size: number; count: number } | null;
    /** Notification channels only: the newest message sent through it. */
    lastSent: { at: string; status: string } | null;
}

export const HEALTH_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;
const FINISHED_STATUSES = ["Success", "Failed", "Partial"];

/**
 * Groups a day of health checks into hourly buckets. A failed check marks its hour even
 * when the others passed, because one failure is what a person looking for trouble wants to see.
 */
export function healthBuckets(
    checks: { status: string; createdAt: Date }[],
    now: Date,
): { health: HealthBucket[]; checksPassed: number | null } {
    const start = now.getTime() - HEALTH_HOURS * HOUR_MS;
    const health: HealthBucket[] = Array.from({ length: HEALTH_HOURS }, () => "none");
    let passed = 0;
    let total = 0;

    for (const check of checks) {
        const offset = check.createdAt.getTime() - start;
        if (offset < 0 || offset > HEALTH_HOURS * HOUR_MS) continue;
        // A check at this very moment belongs to the newest hour, not to one after it.
        const hour = Math.min(HEALTH_HOURS - 1, Math.floor(offset / HOUR_MS));
        total++;
        if (check.status === "ONLINE") {
            passed++;
            if (health[hour] === "none") health[hour] = "ok";
        } else if (check.status === "OFFLINE") {
            health[hour] = "offline";
        } else if (health[hour] !== "offline") {
            health[hour] = "failed";
        }
    }

    return { health, checksPassed: total === 0 ? null : Math.round((passed / total) * 1000) / 10 };
}

/**
 * The overview for a set of adapter configs, keyed by id. Cached for a minute per set, and
 * cleared early when a backup finishes, since that changes the last backup.
 */
export async function getConnectionOverview(ids: string[]): Promise<Map<string, ConnectionOverview>> {
    if (ids.length === 0) return new Map();
    const key = `connections:overview:${[...ids].sort().join(",")}`;
    const entries = await cached(key, CACHE_TTL_MS, () => loadOverview(ids, new Date()));
    return new Map(entries);
}

async function loadOverview(ids: string[], now: Date): Promise<[string, ConnectionOverview][]> {
    const since = new Date(now.getTime() - HEALTH_HOURS * HOUR_MS);

    const [configs, sourceJobs, destinationJobs, directoryJobs, notifyingJobs, templateChannels, checks] = await Promise.all([
        prisma.adapterConfig.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                type: true,
                storageRole: true,
                primaryCredential: { select: { name: true } },
                defaultRetentionPolicy: { select: { name: true } },
            },
        }),
        prisma.job.findMany({ where: { sourceId: { in: ids } }, select: { id: true, sourceId: true } }),
        prisma.jobDestination.findMany({ where: { configId: { in: ids } }, select: { configId: true, jobId: true } }),
        prisma.jobSource.findMany({ where: { configId: { in: ids } }, select: { configId: true, jobId: true } }),
        prisma.job.findMany({
            where: { notifications: { some: { id: { in: ids } } } },
            select: { id: true, notifications: { where: { id: { in: ids } }, select: { id: true } } },
        }),
        prisma.notificationTemplateChannel.findMany({ where: { configId: { in: ids } }, select: { configId: true } }),
        prisma.healthCheckLog.findMany({
            where: { adapterConfigId: { in: ids }, createdAt: { gte: since } },
            select: { adapterConfigId: true, status: true, latencyMs: true, createdAt: true },
            orderBy: { createdAt: "asc" },
        }),
    ]);

    // A job can reach one connection through several paths, so each config collects job ids once.
    const jobsByConfig = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
    const addJob = (configId: string | null, jobId: string) => configId && jobsByConfig.get(configId)?.add(jobId);
    for (const job of sourceJobs) addJob(job.sourceId, job.id);
    for (const link of destinationJobs) addJob(link.configId, link.jobId);
    for (const link of directoryJobs) addJob(link.configId, link.jobId);
    for (const job of notifyingJobs) for (const channel of job.notifications) addJob(channel.id, job.id);

    const templatesByConfig = new Map<string, number>();
    for (const channel of templateChannels) {
        templatesByConfig.set(channel.configId, (templatesByConfig.get(channel.configId) ?? 0) + 1);
    }

    const checksByConfig = new Map<string, typeof checks>();
    for (const check of checks) {
        const list = checksByConfig.get(check.adapterConfigId) ?? [];
        list.push(check);
        checksByConfig.set(check.adapterConfigId, list);
    }

    const jobIds = [...new Set([...jobsByConfig.values()].flatMap((set) => [...set]))];
    const notificationIds = configs.filter((config) => config.type === "notification").map((config) => config.id);
    const hasDestinations = configs.some((config) => config.type === "storage" && config.storageRole === STORAGE_ROLES.DESTINATION);

    const [lastRuns, lastSends, storage] = await Promise.all([
        latestRunPerJob(jobIds),
        latestSendPerChannel(notificationIds),
        hasDestinations ? getStorageVolume() : Promise.resolve([]),
    ]);
    const storageById = new Map(storage.filter((entry) => entry.configId).map((entry) => [entry.configId!, entry]));

    return configs.map((config): [string, ConnectionOverview] => {
        const jobs = jobsByConfig.get(config.id) ?? new Set<string>();
        const configChecks = checksByConfig.get(config.id) ?? [];
        const lastPassed = [...configChecks].reverse().find((check) => check.status === "ONLINE");
        const isDestination = config.type === "storage" && config.storageRole === STORAGE_ROLES.DESTINATION;
        const volume = isDestination ? storageById.get(config.id) : undefined;
        // A destination that was never listed has no numbers yet, only placeholders.
        const scanned = volume !== undefined && !(volume.scanError && !volume.lastScanAt);

        let lastBackup: ConnectionOverview["lastBackup"] = null;
        for (const jobId of jobs) {
            const run = lastRuns.get(jobId);
            if (run && (!lastBackup || run.at > lastBackup.at)) lastBackup = run;
        }

        return [config.id, {
            usedBy: { jobs: jobs.size, templates: templatesByConfig.get(config.id) ?? 0 },
            lastBackup,
            ...healthBuckets(configChecks, now),
            latencyMs: lastPassed?.latencyMs ?? null,
            credentialName: config.primaryCredential?.name ?? null,
            retentionName: isDestination ? config.defaultRetentionPolicy?.name ?? null : null,
            stored: volume && scanned ? { size: volume.size, count: volume.count } : null,
            lastSent: lastSends.get(config.id) ?? null,
        }];
    });
}

/** The newest finished backup of each job. Two queries, however many jobs there are. */
export async function latestRunPerJob(jobIds: string[]): Promise<Map<string, FinishedRun>> {
    const result = new Map<string, FinishedRun>();
    if (jobIds.length === 0) return result;

    const newest = await prisma.execution.groupBy({
        by: ["jobId"],
        where: { jobId: { in: jobIds }, type: "Backup", status: { in: FINISHED_STATUSES } },
        _max: { startedAt: true },
    });
    const keys = newest.flatMap((row) => (row.jobId && row._max.startedAt ? [{ jobId: row.jobId, startedAt: row._max.startedAt }] : []));
    if (keys.length === 0) return result;

    const runs = await prisma.execution.findMany({
        where: { OR: keys, type: "Backup", status: { in: FINISHED_STATUSES } },
        select: { id: true, jobId: true, status: true, startedAt: true },
    });
    for (const run of runs) {
        if (run.jobId) result.set(run.jobId, { id: run.id, at: run.startedAt.toISOString(), status: run.status });
    }
    return result;
}

/** The newest message of each notification channel. */
async function latestSendPerChannel(channelIds: string[]): Promise<Map<string, { at: string; status: string }>> {
    const result = new Map<string, { at: string; status: string }>();
    if (channelIds.length === 0) return result;

    const newest = await prisma.notificationLog.groupBy({
        by: ["channelId"],
        where: { channelId: { in: channelIds } },
        _max: { sentAt: true },
    });
    const keys = newest.flatMap((row) => (row.channelId && row._max.sentAt ? [{ channelId: row.channelId, sentAt: row._max.sentAt }] : []));
    if (keys.length === 0) return result;

    const sends = await prisma.notificationLog.findMany({
        where: { OR: keys },
        select: { channelId: true, status: true, sentAt: true },
    });
    for (const send of sends) {
        if (send.channelId) result.set(send.channelId, { at: send.sentAt.toISOString(), status: send.status });
    }
    return result;
}
