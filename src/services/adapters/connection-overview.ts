/**
 * What the connection tables show next to the configuration: who uses a connection, how
 * its backups went, how its health checks went, and what it stores.
 *
 * Kept apart from the adapter list itself because every value here is an aggregate over
 * other tables. The list is polled every few seconds for its live status, while these
 * values change far more slowly and come from a short cache.
 *
 * A destination or channel another tenant shares with the tenant that runs now gets what this
 * tenant does with it: its own jobs, templates, backups and messages, which the tenant filter
 * narrows every query to. Its health checks, credential and retention stay with the tenant that
 * shares it, so its overview has none.
 */

import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { currentTenantId } from "@/lib/tenant/current";
import { cached } from "@/services/dashboard/cache";
import { getStorageVolume } from "@/services/dashboard-service";
import { providedTo } from "@/services/sharing/provided";
import { newestBackupIds, readInChunks } from "@/services/history/newest-runs";
import { checksOf, noChecks, type HealthBucket } from "./connection-health";

// The health of a connection over the last day, kept where the pages and the details import it from.
export { HEALTH_HOURS, healthBuckets, type HealthBucket } from "./connection-health";

/** A finished backup, with the execution id to link it. */
export interface FinishedRun {
    id: string;
    at: string;
    status: string;
}

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

const CACHE_TTL_MS = 60_000;
const FINISHED_STATUSES = ["Success", "Failed", "Partial"];
/** How many channels one query of their newest messages names. */
const CHANNELS_PER_QUERY = 500;

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

/** A connection the overview describes, its own or one another tenant shares with this one. */
interface OverviewConfig {
    id: string;
    type: string;
    storageRole: string;
    primaryCredential: { name: string } | null;
    defaultRetentionPolicy: { name: string } | null;
    /** Another tenant shares it with the tenant that runs now. */
    provided?: boolean;
}

/**
 * The connections among `ids` other tenants share with the tenant that runs now, which the tenant
 * filter keeps out of its own read. None outside a tenant.
 */
async function providedConfigs(ids: string[]): Promise<OverviewConfig[]> {
    if (ids.length === 0) return [];
    const tenantId = await currentTenantId();
    if (!tenantId) return [];
    const provided = await providedTo(tenantId, { ids });
    return provided.map((connection) => ({
        id: connection.id,
        type: connection.type,
        storageRole: connection.storageRole,
        primaryCredential: null,
        defaultRetentionPolicy: null,
        provided: true,
    }));
}

async function loadOverview(ids: string[], now: Date): Promise<[string, ConnectionOverview][]> {
    const [own, sourceJobs, destinationJobs, directoryJobs, notifyingJobs, templateChannels] = await Promise.all([
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
    ]);
    const found = new Set(own.map((config) => config.id));
    // The checks of the own connections only, which the client found in this tenant.
    const checks = await checksOf([...found], now);
    const configs: OverviewConfig[] = [...own, ...(await providedConfigs(ids.filter((id) => !found.has(id))))];

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
        // How the checks of a provided connection went stays with its tenant, the list shows its status.
        const configChecks = config.provided ? noChecks() : checks.get(config.id) ?? noChecks();
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
            ...configChecks,
            credentialName: config.primaryCredential?.name ?? null,
            retentionName: isDestination ? config.defaultRetentionPolicy?.name ?? null : null,
            stored: volume && scanned ? { size: volume.size, count: volume.count } : null,
            lastSent: lastSends.get(config.id) ?? null,
        }];
    });
}

/** The newest finished backup of each job. One lookup per job in one query, however many jobs there are. */
export async function latestRunPerJob(jobIds: string[]): Promise<Map<string, FinishedRun>> {
    const result = new Map<string, FinishedRun>();
    if (jobIds.length === 0) return result;

    const ids = await newestBackupIds(jobIds, { statuses: FINISHED_STATUSES });
    const runs = await readInChunks(ids, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { id: true, jobId: true, status: true, startedAt: true },
    }));
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

    // In chunks, since a condition with one branch per channel failed past 10,000 with "Expression tree is too large".
    for (let start = 0; start < keys.length; start += CHANNELS_PER_QUERY) {
        const sends = await prisma.notificationLog.findMany({
            where: { OR: keys.slice(start, start + CHANNELS_PER_QUERY) },
            select: { channelId: true, status: true, sentAt: true },
        });
        for (const send of sends) {
            if (send.channelId) result.set(send.channelId, { at: send.sentAt.toISOString(), status: send.status });
        }
    }
    return result;
}
