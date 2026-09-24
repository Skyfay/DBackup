import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { isListingStale, storageService } from "./storage-service";
import { buildExplorer, normalizePath, timeOf, type DestinationListing, type ExplorerModel, type JobRecord } from "./explorer-model";
import type {
    DestinationBackup,
    ExplorerDestination,
    ExplorerFile,
    ExplorerDestinationView,
    ExplorerIndex,
    ExplorerJobView,
    HealthStatus,
    RunExecution,
} from "./explorer-types";

const log = logger.child({ service: "StorageExplorerService" });

const EXECUTION_LOOKUP_SLICE = 400;

const HEALTH_STATUSES: HealthStatus[] = ["ONLINE", "DEGRADED", "OFFLINE"];

interface Loaded {
    destinations: ExplorerDestination[];
    model: ExplorerModel;
}

/**
 * The Storage Explorer's view of every destination at once: by job, with the copies of each run
 * side by side, and by destination, with where else each backup lies.
 *
 * Reads only the cached listings, so a page never waits for a storage. The cache is kept in step by
 * every upload, deletion, lock and check, compared with the storage by the hourly Pre-warm Storage
 * Cache task, and listed in the background when a page finds it missing, outdated or old.
 */
export class StorageExplorerService {
    private async loadJobs(): Promise<JobRecord[]> {
        const jobs = await prisma.job.findMany({
            select: {
                id: true,
                name: true,
                backupMode: true,
                source: { select: { adapterId: true, name: true } },
                sources: { select: { id: true } },
                destinations: { select: { configId: true }, orderBy: { priority: "asc" } },
            },
        });
        return jobs.map((job) => ({
            id: job.id,
            name: job.name,
            incremental: job.backupMode === "INCREMENTAL",
            sourceType: job.source?.adapterId ?? null,
            sourceName: job.source?.name ?? null,
            hasFolders: job.sources.length > 0,
            destinationIds: job.destinations.map((destination) => destination.configId),
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
                health: { status, checkedAt: config.lastHealthCheck?.toISOString() ?? null, error: config.lastError },
                count: files.length,
                size: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
            };
        });

        const listings: DestinationListing[] = configs.map((config, index) => ({ destinationId: config.id, files: listed[index].files }));
        return { destinations, model: buildExplorer(jobs, listings) };
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

    /** The runs of one job, each with its copies and the run that made it while History still has it. */
    async getJobView(key: string): Promise<ExplorerJobView | null> {
        const { model } = await this.load();
        const job = model.jobs.find((entry) => entry.key === key);
        if (!job) return null;

        const runs = model.runs.get(key) ?? [];
        const executions = await this.executionsFor(runs.map((run) => run.path));
        return { job, runs: runs.map((run) => ({ ...run, execution: executions.get(run.path) ?? null })) };
    }

    /** The backups of one destination, each with the job it belongs to and its copies elsewhere. */
    async getDestinationView(destinationId: string): Promise<ExplorerDestinationView | null> {
        const { destinations, model } = await this.load();
        const destination = destinations.find((entry) => entry.id === destinationId);
        if (!destination) return null;

        const backups: DestinationBackup[] = [];
        for (const runs of model.runs.values()) {
            for (const run of runs) {
                const here = run.copies.find((copy) => copy.destinationId === destinationId && copy.state === "stored");
                if (!here?.file) continue;
                backups.push({
                    file: here.file,
                    jobKey: run.jobKey,
                    elsewhere: run.copies
                        .filter((copy) => copy.destinationId !== destinationId)
                        .map((copy) => ({ destinationId: copy.destinationId, state: copy.state })),
                });
            }
        }
        backups.sort((a, b) => timeOf(b.file) - timeOf(a.file));
        return { destination, backups };
    }

    /** The runs History still holds for these backups, by path. */
    private async executionsFor(paths: string[]): Promise<Map<string, RunExecution>> {
        if (paths.length === 0) return new Map();
        // The runner records the path without a leading slash, older runs may have one.
        const candidates = paths.flatMap((path) => [path, `/${path}`]);
        const rows = [];
        // In slices, so a job with thousands of backups stays under SQLite's limit of variables.
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
