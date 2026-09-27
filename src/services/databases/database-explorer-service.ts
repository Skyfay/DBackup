import prisma from "@/lib/prisma";
import { compareVersions } from "@/lib/utils";
import { runsBetween } from "@/services/storage/explorer-plan";
import {
    coverageOf, databaseKey, destinationsOfRun, isInstance, jobHolds, lastBackupOfJobs, lastBackupsOf, namesOfRun, parseJobDatabases, parseListedDatabases, type KeptRun,
} from "./database-explorer-model";
import type {
    DatabaseOverview, DatabaseRun, DatabaseRuns, ExplorerDatabase, ExplorerDbJob, ExplorerServer, LastBackup, PlannedRun, RunStatus, VersionChange,
} from "./database-explorer-types";

/** How many kept runs of a job are searched for the last backup of each of its databases. */
const LAST_RUNS = 40;
/** The longest span the runs of the timeline are asked for at once. */
const MAX_SPAN_MS = 120 * 86_400_000;
const STATUSES = new Set<RunStatus>(["Success", "Partial", "Failed", "Running", "Pending", "Cancelled"]);
const SERVER_STATES = new Set(["ONLINE", "DEGRADED", "OFFLINE"]);

function versionOf(metadata: string | null): string | null {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata) as { engineVersion?: unknown };
        return typeof parsed.engineVersion === "string" && parsed.engineVersion.trim() ? parsed.engineVersion.trim() : null;
    } catch {
        return null;
    }
}

const toNumber = (value: bigint | number | null): number | null => (value === null ? null : Number(value));

/**
 * The page model of the Database Explorer: every database of every server from the list cache,
 * the jobs that back each up, its last backup, and the runs, version changes and planned runs
 * of the timeline. Nothing here asks a server, that is `DatabaseListService`.
 */
export class DatabaseExplorerService {
    /** Every server and its databases. The jobs, the coverage and the last backups only when the viewer may see jobs. */
    async getOverview({ withJobs }: { withJobs: boolean }): Promise<DatabaseOverview> {
        const [sources, jobs] = await Promise.all([
            prisma.adapterConfig.findMany({
                where: { type: "database" },
                select: {
                    id: true,
                    name: true,
                    adapterId: true,
                    metadata: true,
                    lastStatus: true,
                    databaseListCache: { select: { databasesJson: true, readAt: true, error: true } },
                    versionHistory: {
                        where: { previousVersion: { not: null } },
                        orderBy: { detectedAt: "desc" },
                        take: 1,
                        select: { previousVersion: true, detectedAt: true },
                    },
                },
                orderBy: { name: "asc" },
            }),
            withJobs ? this.jobs() : Promise.resolve<ExplorerDbJob[]>([]),
        ]);

        const servers: ExplorerServer[] = sources.map((source) => {
            const change = source.versionHistory[0];
            return {
                id: source.id,
                name: source.name,
                adapterId: source.adapterId,
                version: versionOf(source.metadata),
                versionSince: change ? change.detectedAt.toISOString() : null,
                previousVersion: change?.previousVersion ?? null,
                status: SERVER_STATES.has(source.lastStatus) ? (source.lastStatus as ExplorerServer["status"]) : "ONLINE",
                readAt: source.databaseListCache?.readAt?.toISOString() ?? null,
                readError: source.databaseListCache?.error ?? null,
            };
        });

        const instances = sources.filter((source) => isInstance(source.adapterId));
        const listed = sources
            .filter((source) => !isInstance(source.adapterId))
            .flatMap((source) => parseListedDatabases(source.databaseListCache?.databasesJson).map((database) => ({ serverId: source.id, ...database })));
        const kept = withJobs ? await this.keptRuns(jobs) : [];
        const coverage = withJobs ? coverageOf(listed, jobs) : new Map<string, string[]>();
        const lastBackups = withJobs ? lastBackupsOf(kept, jobs, listed) : new Map<string, LastBackup>();

        const databases: ExplorerDatabase[] = listed.map((database) => {
            const key = databaseKey(database.serverId, database.name);
            return {
                key,
                serverId: database.serverId,
                kind: "database",
                name: database.name,
                sizeInBytes: database.sizeInBytes ?? null,
                tableCount: database.tableCount ?? null,
                keyCount: null,
                logical: [],
                emptyLogical: 0,
                jobIds: coverage.get(key) ?? [],
                lastBackup: lastBackups.get(key) ?? null,
            };
        });

        // A Redis or Valkey server is one entry, backed up by every enabled job of it, since a job
        // takes all its numbered databases. The ones without a key are only counted.
        for (const source of instances) {
            const numbered = parseListedDatabases(source.databaseListCache?.databasesJson);
            if (numbered.length === 0) continue;
            const logical = numbered.filter((database) => (database.tableCount ?? 0) > 0).map((database) => ({ name: database.name, keys: database.tableCount ?? 0 }));
            const jobIds = jobs.filter((job) => job.enabled && job.serverId === source.id).map((job) => job.id);
            databases.push({
                key: source.id,
                serverId: source.id,
                kind: "instance",
                name: source.name,
                sizeInBytes: null,
                tableCount: null,
                keyCount: logical.reduce((sum, database) => sum + database.keys, 0),
                logical,
                emptyLogical: numbered.length - logical.length,
                jobIds,
                lastBackup: lastBackupOfJobs(kept, jobIds),
            });
        }

        return { servers, databases, jobs, coverage: withJobs };
    }

    /** The runs of the jobs that back up databases between two times, the version changes then, and the planned runs until the end. */
    async getRuns(from: Date, until: Date, now = new Date()): Promise<DatabaseRuns> {
        const start = new Date(Math.max(from.getTime(), until.getTime() - MAX_SPAN_MS));
        const [jobs, executions, changes, timezone] = await Promise.all([
            this.jobs(),
            prisma.execution.findMany({
                where: { type: "Backup", job: { sourceId: { not: null } }, startedAt: { gte: start, lte: until } },
                orderBy: { startedAt: "asc" },
                select: { id: true, jobId: true, status: true, startedAt: true, size: true, metadata: true },
            }),
            prisma.dbVersionHistory.findMany({
                where: { previousVersion: { not: null }, detectedAt: { gte: start, lte: until }, adapterConfig: { type: "database" } },
                orderBy: { detectedAt: "asc" },
                select: { adapterConfigId: true, previousVersion: true, newVersion: true, detectedAt: true },
            }),
            this.timezone(),
        ]);
        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const lists = await this.listsByServer();

        const runs: DatabaseRun[] = executions.flatMap((execution) => {
            const job = execution.jobId ? jobsById.get(execution.jobId) : undefined;
            if (!job || !STATUSES.has(execution.status as RunStatus)) return [];
            // A run that failed before it knew what it backs up stands for what its job holds.
            const names = namesOfRun(execution.metadata)
                ?? (lists.get(job.serverId) ?? []).filter((name) => jobHolds(job, job.serverId, name));
            return [{
                id: execution.id,
                jobId: job.id,
                serverId: job.serverId,
                status: execution.status as RunStatus,
                startedAt: execution.startedAt.toISOString(),
                size: toNumber(execution.size),
                databases: names,
                destinations: destinationsOfRun(execution.metadata),
            }];
        });

        const versionChanges: VersionChange[] = changes.map((change) => ({
            serverId: change.adapterConfigId,
            previousVersion: change.previousVersion ?? "",
            newVersion: change.newVersion,
            detectedAt: change.detectedAt.toISOString(),
            downgrade: compareVersions(change.newVersion, change.previousVersion ?? undefined) < 0,
        }));

        const planned: PlannedRun[] = [];
        if (until > now) {
            for (const job of jobs) {
                if (!job.enabled || !job.schedule) continue;
                const { times } = runsBetween(job.schedule, timezone, now.getTime(), until.getTime());
                for (const time of times) planned.push({ jobId: job.id, at: new Date(time).toISOString() });
            }
        }

        return { runs, versionChanges, planned };
    }

    private async jobs(): Promise<ExplorerDbJob[]> {
        const rows = await prisma.job.findMany({
            where: { sourceId: { not: null } },
            select: { id: true, name: true, sourceId: true, enabled: true, databases: true, schedule: true, schedulePreset: { select: { schedule: true } } },
            orderBy: { name: "asc" },
        });
        return rows.map((job) => ({
            id: job.id,
            name: job.name,
            serverId: job.sourceId as string,
            enabled: job.enabled,
            databases: parseJobDatabases(job.databases),
            schedule: (job.schedulePreset?.schedule ?? job.schedule ?? "").trim() || null,
        }));
    }

    /** The newest kept runs of every job, newest first overall. */
    private async keptRuns(jobs: ExplorerDbJob[]): Promise<KeptRun[]> {
        if (jobs.length === 0) return [];
        const perJob = await Promise.all(jobs.map((job) => prisma.execution.findMany({
            where: { jobId: job.id, type: "Backup", status: { in: ["Success", "Partial"] } },
            orderBy: { startedAt: "desc" },
            take: LAST_RUNS,
            select: { id: true, jobId: true, status: true, startedAt: true, size: true, metadata: true },
        })));
        return perJob
            .flat()
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            .map((run) => ({
                id: run.id,
                jobId: run.jobId as string,
                status: run.status as KeptRun["status"],
                startedAt: run.startedAt.toISOString(),
                size: toNumber(run.size),
                names: namesOfRun(run.metadata),
            }));
    }

    /** The database names of every server as the list cache holds them. */
    private async listsByServer(): Promise<Map<string, string[]>> {
        const rows = await prisma.databaseListCache.findMany({ select: { adapterConfigId: true, databasesJson: true } });
        return new Map(rows.map((row) => [row.adapterConfigId, parseListedDatabases(row.databasesJson).map((database) => database.name)]));
    }

    private async timezone(): Promise<string> {
        const setting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
        return setting?.value || "UTC";
    }
}

export const databaseExplorerService = new DatabaseExplorerService();
