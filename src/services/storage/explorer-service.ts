import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { isListingStale, storageService } from "./storage-service";
import { defaultAlertConfig, defaultAlertStates, getAlertConfig, getAlertStates } from "./storage-alert-service";
import { retentionConfigOf } from "./explorer-plan";
import { buildExplorer, normalizePath, type DestinationListing, type ExplorerModel, type JobRecord } from "./explorer-model";
import type { DestinationAlerts, ExplorerBackups, ExplorerDestination, ExplorerFile, ExplorerIndex, HealthStatus, RunExecution } from "./explorer-types";

const log = logger.child({ service: "StorageExplorerService" });

const EXECUTION_LOOKUP_SLICE = 400;

const HEALTH_STATUSES: HealthStatus[] = ["ONLINE", "DEGRADED", "OFFLINE"];
const WEEK_MS = 7 * 86_400_000;

interface Loaded {
    destinations: ExplorerDestination[];
    model: ExplorerModel;
}

/**
 * The Storage Explorer's view of every destination at once: every backup with its copies side by
 * side, which the page filters by job and by destination, and the backups of one destination.
 *
 * Reads only the cached listings, so a page never waits for a storage. The cache is kept in step by
 * every upload, deletion, lock and check, compared with the storage by the hourly Pre-warm Storage
 * Cache task, and listed in the background when a page finds it missing, outdated or old.
 */
export class StorageExplorerService {
    private async loadJobs(): Promise<JobRecord[]> {
        const [jobs, fallback] = await Promise.all([
            prisma.job.findMany({
                select: {
                    id: true,
                    name: true,
                    backupMode: true,
                    source: { select: { adapterId: true, name: true } },
                    sources: { select: { id: true } },
                    destinations: {
                        select: { configId: true, retention: true, retentionPolicyId: true, retentionPolicy: { select: { config: true } } },
                        orderBy: { priority: "asc" },
                    },
                },
            }),
            prisma.retentionPolicy.findFirst({ where: { isDefault: true }, select: { config: true } }),
        ]);
        return jobs.map((job) => ({
            id: job.id,
            name: job.name,
            incremental: job.backupMode === "INCREMENTAL",
            sourceType: job.source?.adapterId ?? null,
            sourceName: job.source?.name ?? null,
            hasFolders: job.sources.length > 0,
            destinationIds: job.destinations.map((destination) => destination.configId),
            retention: Object.fromEntries(job.destinations.flatMap((destination) => {
                const config = retentionConfigOf(destination, fallback?.config ?? null);
                return config ? [[destination.configId, config]] : [];
            })),
        }));
    }

    private async load(): Promise<Loaded> {
        const [configs, jobs] = await Promise.all([
            prisma.adapterConfig.findMany({
                where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
                select: { id: true, name: true, adapterId: true, lastStatus: true, lastHealthCheck: true, lastError: true },
                orderBy: { name: "asc" },
            }),
            this.loadJobs(),
        ]);

        // A page never waits for a storage. It shows what the cache holds, and what is missing, from an
        // older version or old is listed in the background while the page asks again. A destination
        // the health check calls offline is left to the hourly task and to Check now.
        const listed = await Promise.all(configs.map(async (config) => {
            const cached = await storageService.readCachedListing(config.id).catch((error: unknown) => {
                log.warn("Could not read the cached listing", { destinationId: config.id }, wrapError(error));
                return null;
            });
            if (config.lastStatus !== "OFFLINE") {
                if (!cached || !cached.current) storageService.refreshInBackground(config.id, "rebuild");
                else if (isListingStale(cached.listedAt)) storageService.refreshInBackground(config.id, "reconcile");
            }
            // A fresh listing holds dates, a cached one strings. The explorer sends strings.
            const files: ExplorerFile[] = (cached?.files ?? []).map((file) => ({ ...file, lastModified: new Date(file.lastModified).toISOString() }));
            return {
                files,
                listedAt: cached ? cached.listedAt.toISOString() : null,
                error: storageService.listingFailure(config.id)?.error ?? null,
                listing: storageService.isListing(config.id),
            };
        }));

        const now = Date.now();
        const [checks, growths, alerts] = await Promise.all([
            Promise.all(configs.map((config) => this.lastChecks(config.id, config.lastStatus))),
            Promise.all(configs.map((config) => this.growthOf(config.id, now))),
            Promise.all(configs.map((config) => this.alertsOf(config.id))),
        ]);

        const destinations: ExplorerDestination[] = configs.map((config, index) => {
            const { files, listedAt, error, listing } = listed[index];
            const status = HEALTH_STATUSES.includes(config.lastStatus as HealthStatus) ? (config.lastStatus as HealthStatus) : "ONLINE";
            return {
                id: config.id,
                name: config.name,
                adapterId: config.adapterId,
                listedAt,
                listError: error,
                listing,
                health: { status, checkedAt: config.lastHealthCheck?.toISOString() ?? null, error: config.lastError, ...checks[index] },
                count: files.length,
                size: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
                growth: growths[index],
                alerts: alerts[index],
            };
        });

        const listings: DestinationListing[] = configs.map((config, index) => ({ destinationId: config.id, files: listed[index].files }));
        return { destinations, model: buildExplorer(jobs, listings) };
    }

    /**
     * How long the last connection check of a destination took and, while it does not answer, when
     * it last did. One lookup each on the index of the check log, so every page load can afford it.
     */
    private async lastChecks(destinationId: string, status: string): Promise<{ latencyMs: number | null; answeredAt: string | null }> {
        try {
            const [last, answered] = await Promise.all([
                prisma.healthCheckLog.findFirst({ where: { adapterConfigId: destinationId }, orderBy: { createdAt: "desc" }, select: { latencyMs: true } }),
                status === "ONLINE"
                    ? null
                    : prisma.healthCheckLog.findFirst({
                        where: { adapterConfigId: destinationId, status: "ONLINE" },
                        orderBy: { createdAt: "desc" },
                        select: { createdAt: true },
                    }),
            ]);
            return { latencyMs: last?.latencyMs ?? null, answeredAt: answered?.createdAt.toISOString() ?? null };
        } catch (error: unknown) {
            log.warn("Could not read the connection checks", { destinationId }, wrapError(error));
            return { latencyMs: null, answeredAt: null };
        }
    }

    /** How much a destination grew in the last 7 days, from the newest measurement and the one a week before it. */
    private async growthOf(destinationId: string, now: number): Promise<number | null> {
        try {
            const [latest, before] = await Promise.all([
                prisma.storageSnapshot.findFirst({ where: { adapterConfigId: destinationId }, orderBy: { createdAt: "desc" }, select: { size: true } }),
                prisma.storageSnapshot.findFirst({
                    where: { adapterConfigId: destinationId, createdAt: { lte: new Date(now - WEEK_MS) } },
                    orderBy: { createdAt: "desc" },
                    select: { size: true },
                }),
            ]);
            return latest && before ? Number(latest.size) - Number(before.size) : null;
        } catch (error: unknown) {
            log.warn("Could not read the size history", { destinationId }, wrapError(error));
            return null;
        }
    }

    /** The storage alerts of a destination with the ones that fire right now. When they cannot be read, the list shows them as off. */
    private async alertsOf(destinationId: string): Promise<DestinationAlerts> {
        const [config, states] = await Promise.all([getAlertConfig(destinationId), getAlertStates(destinationId)]).catch((error: unknown) => {
            log.warn("Could not read the storage alerts", { destinationId }, wrapError(error));
            return [defaultAlertConfig(), defaultAlertStates()] as const;
        });
        return {
            usageSpike: { enabled: config.usageSpikeEnabled, percent: config.usageSpikeThresholdPercent, active: config.usageSpikeEnabled && states.usageSpike.active },
            storageLimit: { enabled: config.storageLimitEnabled, bytes: config.storageLimitBytes, active: config.storageLimitEnabled && states.storageLimit.active },
            missingBackup: { enabled: config.missingBackupEnabled, hours: config.missingBackupHours, active: config.missingBackupEnabled && states.missingBackup.active },
        };
    }

    /** Compares these destinations with the storage in the background, for Check now. Returns those that are being listed. */
    async checkNow(destinationIds: string[]): Promise<string[]> {
        const known = await prisma.adapterConfig.findMany({
            where: { id: { in: destinationIds }, type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
            select: { id: true },
        });
        const started = await Promise.all(known.map(async ({ id }) => ((await storageService.checkNow(id)) ? id : null)));
        return started.filter((id): id is string => id !== null);
    }

    /** Every destination and every job with its numbers, for the pickers and the tabs. */
    async getIndex(): Promise<ExplorerIndex> {
        const { destinations, model } = await this.load();
        return { destinations, jobs: model.jobs };
    }

    /** Every backup of every job, newest first, each with its copies at every destination. */
    async getBackups(): Promise<ExplorerBackups> {
        const { model } = await this.load();
        const runs = [...model.runs.values()].flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        return { runs };
    }

    /**
     * The run that made a backup while History still has it. Asked for one backup at a time, when its
     * details open, since History keeps no index by path.
     */
    async getExecution(path: string): Promise<RunExecution | null> {
        const normalized = normalizePath(path);
        return (await this.executionsFor([normalized])).get(normalized) ?? null;
    }

    /** The runs History still holds for these backups, by path. */
    private async executionsFor(paths: string[]): Promise<Map<string, RunExecution>> {
        if (paths.length === 0) return new Map();
        // The runner records the path without a leading slash, older runs may have one.
        const candidates = paths.flatMap((path) => [path, `/${path}`]);
        const rows = [];
        // In slices, so a long list of backups stays under SQLite's limit of variables.
        for (let start = 0; start < candidates.length; start += EXECUTION_LOOKUP_SLICE) {
            rows.push(...await prisma.execution.findMany({
                where: { path: { in: candidates.slice(start, start + EXECUTION_LOOKUP_SLICE) } },
                select: { id: true, status: true, startedAt: true, endedAt: true, path: true },
            }));
        }
        rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        const byPath = new Map<string, RunExecution>();
        for (const row of rows) {
            const path = normalizePath(row.path ?? "");
            if (byPath.has(path)) continue;
            byPath.set(path, { id: row.id, status: row.status, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null });
        }
        return byPath;
    }
}

export const storageExplorerService = new StorageExplorerService();
