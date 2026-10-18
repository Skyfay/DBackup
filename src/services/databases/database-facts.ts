import prisma from "@/lib/prisma";
import { newestBackupIds, readInChunks } from "@/services/history/newest-runs";
import {
    coverageOf, databaseKey, groupBy, isInstance, jobsToReadFurther, lastBackupOfJobs, lastBackupsOf, namesOfRun, parseJobDatabases, parseListedDatabases, versionOf,
    type KeptRun, type ListedDatabase,
} from "./database-explorer-model";
import type { ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "./database-explorer-types";

/**
 * What the Database Explorer reads of the servers, the jobs and their runs, shared by the overview
 * and the paged list of the Databases tab. Nothing here asks a server, that is `DatabaseListService`.
 */

/** How many kept runs of a job are searched for the last backup of each of its databases. */
const LAST_RUNS = 40;
const KEPT = ["Success", "Partial"];
const SERVER_STATES = new Set(["ONLINE", "DEGRADED", "OFFLINE"]);

const toNumber = (value: bigint | number | null): number | null => (value === null ? null : Number(value));

/** A database connection as every list needs it, without its version, which only the servers shown need. */
export interface ServerSource {
    id: string;
    name: string;
    adapterId: string;
    tenantId: string;
    status: ExplorerServer["status"];
    readAt: string | null;
    readError: string | null;
    /** What the list cache holds of it. */
    listed: ListedDatabase[];
}

/** The version of a server and its last change. */
export type ServerVersion = Pick<ExplorerServer, "version" | "versionSince" | "previousVersion">;

const NO_VERSION: ServerVersion = { version: null, versionSince: null, previousVersion: null };

/** Every database connection by name, with what the list cache holds of it. */
export async function readSources(): Promise<ServerSource[]> {
    const rows = await prisma.adapterConfig.findMany({
        where: { type: "database" },
        select: {
            id: true,
            name: true,
            adapterId: true,
            // The tenant of the server, which the lists show while they hold every tenant.
            tenantId: true,
            lastStatus: true,
            databaseListCache: { select: { databasesJson: true, readAt: true, error: true } },
        },
        orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        adapterId: row.adapterId,
        tenantId: row.tenantId,
        status: SERVER_STATES.has(row.lastStatus) ? (row.lastStatus as ExplorerServer["status"]) : "ONLINE",
        readAt: row.databaseListCache?.readAt?.toISOString() ?? null,
        readError: row.databaseListCache?.error ?? null,
        listed: parseListedDatabases(row.databaseListCache?.databasesJson),
    }));
}

/** The version the hourly check read last of these servers, or of every one, and when it last changed. */
export async function readVersions(ids?: string[]): Promise<Map<string, ServerVersion>> {
    if (ids && ids.length === 0) return new Map();
    const rows = await prisma.adapterConfig.findMany({
        where: { type: "database", ...(ids ? { id: { in: ids } } : {}) },
        select: {
            id: true,
            metadata: true,
            versionHistory: {
                where: { previousVersion: { not: null } },
                orderBy: { detectedAt: "desc" },
                take: 1,
                select: { previousVersion: true, detectedAt: true },
            },
        },
    });
    return new Map(rows.map((row) => {
        const change = row.versionHistory[0];
        return [row.id, {
            version: versionOf(row.metadata),
            versionSince: change ? change.detectedAt.toISOString() : null,
            previousVersion: change?.previousVersion ?? null,
        }];
    }));
}

export function serverOf(source: ServerSource, version: ServerVersion | undefined): ExplorerServer {
    return {
        id: source.id,
        name: source.name,
        adapterId: source.adapterId,
        tenantId: source.tenantId,
        ...(version ?? NO_VERSION),
        status: source.status,
        readAt: source.readAt,
        readError: source.readError,
    };
}

/** Every job that backs up databases, by name. */
export async function readJobs(): Promise<ExplorerDbJob[]> {
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

/** The newest `take` kept runs of each of the jobs, newest first overall. */
async function keptRuns(jobIds: string[], take: number): Promise<KeptRun[]> {
    if (jobIds.length === 0) return [];
    // The ids come from one query for every job, since a query per job took minutes in All tenants
    // of many tenants, and the rows through the client of the jobs it read.
    const ids = await newestBackupIds(jobIds, { take, statuses: KEPT });
    const rows = await readInChunks(ids, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { id: true, jobId: true, status: true, startedAt: true, size: true, metadata: true },
    }));
    return rows
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

/**
 * The newest kept runs of the jobs as far as they tell the last backup of each database. The newest
 * run of every job is read first, and the last 40 only of the jobs whose newest run left out a
 * database that an older one may hold, which gives what reading 40 of every job gave.
 */
export async function lastBackupRuns(jobs: ExplorerDbJob[], databases: { serverId: string; name: string }[]): Promise<KeptRun[]> {
    const newest = await keptRuns(jobs.map((job) => job.id), 1);
    const further = new Set(jobsToReadFurther(newest, jobs, databases, lastBackupsOf(newest, jobs, databases)));
    if (further.size === 0) return newest;
    const older = await keptRuns([...further], LAST_RUNS);
    const seen = new Set(older.map((run) => run.id));
    return [...newest.filter((run) => !seen.has(run.id)), ...older].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** A database of a server as the lists show it, without its jobs. */
function databaseEntry(source: ServerSource, database: ListedDatabase): ExplorerDatabase {
    return {
        key: databaseKey(source.id, database.name),
        serverId: source.id,
        tenantId: source.tenantId,
        kind: "database",
        name: database.name,
        sizeInBytes: database.sizeInBytes ?? null,
        tableCount: database.tableCount ?? null,
        keyCount: null,
        logical: [],
        emptyLogical: 0,
        jobIds: [],
        lastBackup: null,
    };
}

/**
 * Every database of the servers, then a Redis or Valkey server as one entry, backed up by every
 * enabled job of it since a job takes all its numbered databases. The ones without a key are only
 * counted. With `runs` each gets its jobs and its last backup, for a viewer who may see jobs.
 */
export function databasesOf(sources: ServerSource[], jobs: ExplorerDbJob[] | null, runs: KeptRun[]): ExplorerDatabase[] {
    const listed = sources.filter((source) => !isInstance(source.adapterId))
        .flatMap((source) => source.listed.map((database) => databaseEntry(source, database)));
    if (jobs) {
        const coverage = coverageOf(listed, jobs);
        const lastBackups = lastBackupsOf(runs, jobs, listed);
        for (const database of listed) {
            database.jobIds = coverage.get(database.key) ?? [];
            database.lastBackup = lastBackups.get(database.key) ?? null;
        }
    }
    const jobsByServer = groupBy((jobs ?? []).filter((job) => job.enabled), (job) => job.serverId);
    const instances = sources.filter((source) => isInstance(source.adapterId) && source.listed.length > 0).map((source): ExplorerDatabase => {
        const logical = source.listed.filter((database) => (database.tableCount ?? 0) > 0).map((database) => ({ name: database.name, keys: database.tableCount ?? 0 }));
        const jobIds = (jobsByServer.get(source.id) ?? []).map((job) => job.id);
        return {
            key: source.id,
            serverId: source.id,
            tenantId: source.tenantId,
            kind: "instance",
            name: source.name,
            sizeInBytes: null,
            tableCount: null,
            keyCount: logical.reduce((sum, database) => sum + database.keys, 0),
            logical,
            emptyLogical: source.listed.length - logical.length,
            jobIds,
            lastBackup: jobs ? lastBackupOfJobs(runs, jobIds) : null,
        };
    });
    return [...listed, ...instances];
}

/** The databases with their jobs and last backups, read as `databasesOf` needs them. */
export async function readDatabases(sources: ServerSource[], jobs: ExplorerDbJob[] | null): Promise<ExplorerDatabase[]> {
    if (!jobs) return databasesOf(sources, null, []);
    const listed = sources.filter((source) => !isInstance(source.adapterId))
        .flatMap((source) => source.listed.map((database) => ({ serverId: source.id, name: database.name })));
    return databasesOf(sources, jobs, await lastBackupRuns(jobs, listed));
}
