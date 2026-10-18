import prisma from "@/lib/prisma";
import { SHARED_STORAGE_FAILURE } from "@/lib/tenant/storage-view";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { isListingStale, storageService } from "./storage-service";
import { checksNatively } from "./verification-service";
import { defaultAlertConfig, defaultAlertStates, getAlertConfig, getAlertStates } from "./storage-alert-service";
import { defaultRetentionOf, retentionConfigOf } from "./explorer-plan";
import { buildExplorer, normalizePath, type DestinationListing, type ExplorerModel, type JobRecord } from "./explorer-model";
import type { DestinationAlerts, ExplorerBackup, ExplorerBackups, ExplorerDestination, ExplorerFile, ExplorerIndex, HealthStatus, RunExecution } from "./explorer-types";
import { isAirGapped, isNotConnected } from "@/lib/core/air-gap";
import { currentTenantId } from "@/lib/tenant/current";
import { runAsSystem } from "@/lib/tenant/context";
import { providedTo } from "@/services/sharing/provided";

const log = logger.child({ service: "StorageExplorerService" });

const EXECUTION_LOOKUP_SLICE = 400;

const HEALTH_STATUSES: HealthStatus[] = ["ONLINE", "DEGRADED", "OFFLINE"];
const WEEK_MS = 7 * 86_400_000;

/** The alerts of a destination another tenant shares, which only its tenant sets. */
async function noAlerts(): Promise<DestinationAlerts> {
    const config = defaultAlertConfig();
    return {
        usageSpike: { enabled: false, percent: config.usageSpikeThresholdPercent, active: false },
        storageLimit: { enabled: false, bytes: config.storageLimitBytes, active: false },
        missingBackup: { enabled: false, hours: config.missingBackupHours, active: false },
    };
}

/** Every backup of every job, newest first. */
function newestFirst(model: ExplorerModel): ExplorerBackups["runs"] {
    return [...model.runs.values()].flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

interface Loaded {
    destinations: ExplorerDestination[];
    model: ExplorerModel;
}

const PLACE_SELECT = { id: true, name: true, tenantId: true, adapterId: true, type: true, storageRole: true, metadata: true, lastStatus: true, lastHealthCheck: true, lastError: true } as const;

/**
 * A destination as one tenant sees it: an own one, or one another tenant shares with it, where it
 * sees its own backups alone. `tenantId` is the tenant whose backups the listing holds.
 */
interface Place {
    config: { id: string; name: string; adapterId: string; type: string; storageRole: string; metadata: string | null; lastStatus: string; lastHealthCheck: Date | null; lastError: string | null };
    tenantId: string;
    provider: string | null;
}

/**
 * The destinations the scope that runs now sees: every own destination, and in a tenant also those
 * other tenants share with it. All tenants shows each destination as its own tenant sees it, a
 * customer's backups on a shared one show once its tenant is open.
 */
export async function placesOfScope(): Promise<Place[]> {
    const own = await prisma.adapterConfig.findMany({
        where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: PLACE_SELECT,
        orderBy: { name: "asc" },
    });
    const places: Place[] = own.map((config) => ({ config, tenantId: config.tenantId, provider: null }));
    const tenantId = await currentTenantId();
    if (!tenantId) return places;
    const provided = await providedTo(tenantId, { kind: "destination" });
    if (provided.length === 0) return places;
    const rows = await runAsSystem(() => prisma.adapterConfig.findMany({
        where: { id: { in: provided.map((entry) => entry.id) }, type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: PLACE_SELECT,
    }));
    const providers = new Map(provided.map((entry) => [entry.id, entry.providerName]));
    // The customer never sees why the storage of another tenant fails, only that it does.
    return [...places, ...rows.map((config) => ({ config: { ...config, lastError: null }, tenantId, provider: providers.get(config.id) ?? null }))]
        .sort((a, b) => a.config.name.localeCompare(b.config.name));
}

/**
 * The Backups page's view of every destination at once: every backup with its copies side by
 * side, which the page filters by job and by destination, and the backups of one destination.
 *
 * Reads only the cached listings, so a page never waits for a storage. The cache is kept in step by
 * every upload, deletion, lock and check, compared with the storage by the hourly Pre-warm Storage
 * Cache task, and listed in the background when a page finds it missing, outdated or old.
 */
export class StorageExplorerService {
    private async loadJobs(): Promise<JobRecord[]> {
        const [jobs, defaults] = await Promise.all([
            prisma.job.findMany({
                select: {
                    id: true,
                    name: true,
                    tenantId: true,
                    backupMode: true,
                    source: { select: { adapterId: true, name: true } },
                    sources: { select: { id: true } },
                    destinations: {
                        select: { configId: true, retention: true, retentionPolicyId: true, retentionPolicy: { select: { config: true } } },
                        orderBy: { priority: "asc" },
                    },
                },
            }),
            // One default per tenant, every tenant's in All tenants.
            prisma.retentionPolicy.findMany({ where: { isDefault: true }, select: { tenantId: true, config: true } }),
        ]);
        return jobs.map((job) => ({
            id: job.id,
            name: job.name,
            tenantId: job.tenantId,
            incremental: job.backupMode === "INCREMENTAL",
            sourceType: job.source?.adapterId ?? null,
            sourceName: job.source?.name ?? null,
            hasFolders: job.sources.length > 0,
            destinationIds: job.destinations.map((destination) => destination.configId),
            retention: Object.fromEntries(job.destinations.flatMap((destination) => {
                const config = retentionConfigOf(destination, defaultRetentionOf(defaults, job.tenantId));
                return config ? [[destination.configId, config]] : [];
            })),
        }));
    }

    private async load(): Promise<Loaded> {
        const [places, jobs] = await Promise.all([placesOfScope(), this.loadJobs()]);

        // A page never waits for a storage. It shows what the cache holds, and what is missing, from an
        // older version or old is listed in the background while the page asks again. A destination
        // the health check calls offline is left to the hourly task and to Check now.
        const listed = await Promise.all(places.map(async ({ config, tenantId }) => {
            const cached = await storageService.readCachedListing(config.id, tenantId).catch((error: unknown) => {
                log.warn("Could not read the cached listing", { destinationId: config.id }, wrapError(error));
                return null;
            });
            // An air-gapped destination is listed again once it is connected.
            if (config.lastStatus !== "OFFLINE" && !isNotConnected(config)) {
                if (!cached || !cached.current) storageService.refreshInBackground(config.id, tenantId, "rebuild");
                else if (isListingStale(cached.listedAt)) storageService.refreshInBackground(config.id, tenantId, "reconcile");
            }
            // A fresh listing holds dates, a cached one strings. The explorer sends strings.
            const files: ExplorerFile[] = (cached?.files ?? []).map((file) => ({ ...file, lastModified: new Date(file.lastModified).toISOString() }));
            return {
                files,
                listedAt: cached ? cached.listedAt.toISOString() : null,
                error: storageService.listingFailure(config.id, tenantId)?.error ?? null,
                listing: storageService.isListing(config.id, tenantId),
            };
        }));

        const now = Date.now();
        const [checks, growths, alerts] = await Promise.all([
            // The checks of a shared destination belong to its tenant, the customer reads how they went.
            Promise.all(places.map((place) => (place.provider
                ? runAsSystem(() => this.lastChecks(place.config.id, place.config.lastStatus))
                : this.lastChecks(place.config.id, place.config.lastStatus)))),
            Promise.all(places.map((place) => this.growthOf(place.config.id, place.tenantId, now))),
            Promise.all(places.map((place) => (place.provider ? noAlerts() : this.alertsOf(place.config.id)))),
        ]);

        const destinations: ExplorerDestination[] = places.map(({ config, tenantId, provider }, index) => {
            const { files, listedAt, error, listing } = listed[index];
            const status = HEALTH_STATUSES.includes(config.lastStatus as HealthStatus) ? (config.lastStatus as HealthStatus) : "ONLINE";
            return {
                id: config.id,
                name: config.name,
                tenantId,
                ...(provider ? { provider } : {}),
                adapterId: config.adapterId,
                airGapped: isAirGapped(config),
                checksNatively: checksNatively(config.adapterId),
                listedAt,
                // Why the storage of another tenant failed stays with that tenant.
                listError: provider && error ? SHARED_STORAGE_FAILURE : error,
                listing,
                health: { status, checkedAt: config.lastHealthCheck?.toISOString() ?? null, error: config.lastError, ...checks[index] },
                count: files.length,
                size: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
                growth: growths[index],
                alerts: alerts[index],
            };
        });

        const listings: DestinationListing[] = places.map(({ config, tenantId }, index) => ({ destinationId: config.id, tenantId, files: listed[index].files }));
        const airGapped = new Set(destinations.filter((destination) => destination.airGapped).map((destination) => destination.id));
        return { destinations, model: buildExplorer(jobs, listings, airGapped) };
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

    /**
     * How much a destination grew for a tenant in the last 7 days, from the newest measurement and
     * the one a week before it. A shared destination is measured for each tenant on its own.
     */
    private async growthOf(destinationId: string, tenantId: string, now: number): Promise<number | null> {
        try {
            const [latest, before] = await Promise.all([
                prisma.storageSnapshot.findFirst({ where: { adapterConfigId: destinationId, tenantId }, orderBy: { createdAt: "desc" }, select: { size: true } }),
                prisma.storageSnapshot.findFirst({
                    where: { adapterConfigId: destinationId, tenantId, createdAt: { lte: new Date(now - WEEK_MS) } },
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
        const known = (await placesOfScope()).filter((place) => destinationIds.includes(place.config.id));
        const started = await Promise.all(known.map(async ({ config }) => ((await storageService.checkNow(config.id)) ? config.id : null)));
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
        return { runs: newestFirst(model) };
    }

    /** The same with every destination and when it was listed, from one read of the cache. */
    async getBackupsWithDestinations(): Promise<ExplorerBackups & { destinations: ExplorerDestination[] }> {
        const { destinations, model } = await this.load();
        return { runs: newestFirst(model), destinations };
    }

    /**
     * One backup by the path its run recorded, with its copies, its job and its chain, like the
     * details of the Backups page show it. The Database Explorer asks for it when a day opens.
     */
    async getBackup(path: string): Promise<ExplorerBackup> {
        const { destinations, model } = await this.load();
        const wanted = normalizePath(path);
        for (const [jobKey, runs] of model.runs) {
            const run = runs.find((entry) => normalizePath(entry.path) === wanted);
            if (!run) continue;
            const chainId = run.file.chain?.id;
            const chain = chainId
                ? runs.map((entry) => entry.file).filter((file) => file.chain?.id === chainId).sort((a, b) => (a.chain?.index ?? 0) - (b.chain?.index ?? 0))
                : null;
            return { run, job: model.jobs.find((job) => job.key === jobKey) ?? null, chain, destinations };
        }
        return { run: null, job: null, chain: null, destinations };
    }

    /**
     * The run that made a backup while History still has it. Asked for one backup at a time, when its
     * details open, since History keeps no index by path. In All tenants two tenants can each have a
     * backup at the same path, so the tenant of the backup is named there.
     */
    async getExecution(path: string, tenantId?: string | null): Promise<RunExecution | null> {
        const normalized = normalizePath(path);
        return (await this.executionsFor([normalized], tenantId ?? undefined)).get(normalized) ?? null;
    }

    /** The runs History still holds for these backups, by path, only of the tenant given. */
    private async executionsFor(paths: string[], tenantId?: string): Promise<Map<string, RunExecution>> {
        if (paths.length === 0) return new Map();
        // The runner records the path without a leading slash, older runs may have one.
        const candidates = paths.flatMap((path) => [path, `/${path}`]);
        const rows = [];
        // In slices, so a long list of backups stays under SQLite's limit of variables.
        for (let start = 0; start < candidates.length; start += EXECUTION_LOOKUP_SLICE) {
            rows.push(...await prisma.execution.findMany({
                where: { path: { in: candidates.slice(start, start + EXECUTION_LOOKUP_SLICE) }, ...(tenantId ? { tenantId } : {}) },
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
