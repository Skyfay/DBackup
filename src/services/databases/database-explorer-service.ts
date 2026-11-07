import prisma from "@/lib/prisma";
import { compareVersions } from "@/lib/utils";
import { extractLastError } from "@/services/dashboard/health";
import { runsBetween } from "@/services/storage/explorer-plan";
import { destinationsOfRun, jobHolds, namesOfRun, parseListedDatabases } from "./database-explorer-model";
import type { DatabaseOverview, DatabaseRunRecord, DatabaseRunsData, PlannedRun, RunStatus, VersionChange } from "./database-explorer-types";
import { readDatabases, readJobs, readSources, readVersions, serverOf } from "./database-facts";

/** The longest span the runs of the timeline are asked for at once. */
const MAX_SPAN_MS = 120 * 86_400_000;
const STATUSES = new Set<RunStatus>(["Success", "Partial", "Failed", "Running", "Pending", "Cancelled"]);

const toNumber = (value: bigint | number | null): number | null => (value === null ? null : Number(value));

/**
 * The page model of the Database Explorer: every database of every server from the list cache,
 * the jobs that back each up, its last backup, and the runs, version changes and planned runs
 * of the timeline. Nothing here asks a server, that is `DatabaseListService`.
 */
export class DatabaseExplorerService {
    /** Every server and its databases. The jobs, the coverage and the last backups only when the viewer may see jobs. */
    async getOverview({ withJobs }: { withJobs: boolean }): Promise<DatabaseOverview> {
        const [sources, jobs, versions] = await Promise.all([
            readSources(),
            withJobs ? readJobs() : Promise.resolve(null),
            readVersions(),
        ]);
        const databases = await readDatabases(sources, jobs);
        return {
            servers: sources.map((source) => serverOf(source, versions.get(source.id))),
            databases,
            jobs: jobs ?? [],
            coverage: withJobs,
        };
    }

    /**
     * The runs of the jobs that back up databases between two times, the version changes then, and
     * the planned runs until the end. With `withErrors` a failed run carries the last error it logged,
     * which the panel of a day shows and the timeline does not need.
     */
    async getRuns(from: Date, until: Date, now = new Date(), { withErrors = false }: { withErrors?: boolean } = {}): Promise<DatabaseRunsData> {
        const start = new Date(Math.max(from.getTime(), until.getTime() - MAX_SPAN_MS));
        const [jobs, executions, changes, timezone] = await Promise.all([
            readJobs(),
            prisma.execution.findMany({
                where: { type: "Backup", job: { sourceId: { not: null } }, startedAt: { gte: start, lte: until } },
                orderBy: { startedAt: "asc" },
                select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true, size: true, path: true, metadata: true },
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
        const errors = withErrors ? await this.errorsOf(executions.filter((execution) => execution.status === "Failed").map((execution) => execution.id)) : new Map<string, string>();

        const names: string[][] = [];
        const namesIndex = new Map<string, number>();
        const intern = (list: string[]) => {
            const key = list.join("\u0000");
            let index = namesIndex.get(key);
            if (index === undefined) {
                index = names.length;
                names.push(list);
                namesIndex.set(key, index);
            }
            return index;
        };

        const runs: DatabaseRunRecord[] = executions.flatMap((execution) => {
            const job = execution.jobId ? jobsById.get(execution.jobId) : undefined;
            if (!job || !STATUSES.has(execution.status as RunStatus)) return [];
            // A run that failed before it knew what it backs up stands for what its job holds.
            const held = namesOfRun(execution.metadata)
                ?? (lists.get(job.serverId) ?? []).filter((name) => jobHolds(job, job.serverId, name));
            return [{
                id: execution.id,
                jobId: job.id,
                serverId: job.serverId,
                status: execution.status as RunStatus,
                startedAt: execution.startedAt.toISOString(),
                endedAt: execution.endedAt?.toISOString() ?? null,
                size: toNumber(execution.size),
                path: execution.path ?? null,
                databases: intern(held),
                destinations: destinationsOfRun(execution.metadata),
                error: errors.get(execution.id) ?? null,
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

        return { runs, names, versionChanges, planned };
    }

    /** The last error each failed run logged, read only for those, since logs can be long. */
    private async errorsOf(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const rows = await prisma.execution.findMany({ where: { id: { in: ids } }, select: { id: true, logs: true } });
        return new Map(rows.flatMap((row) => {
            const error = extractLastError(row.logs);
            return error ? [[row.id, error] as const] : [];
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
