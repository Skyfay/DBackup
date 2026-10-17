import { createHash } from "crypto";
import prisma from "@/lib/prisma";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { connectionVersion } from "@/lib/adapters/connection-summary";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runAsSystem } from "@/lib/tenant/context";
import { cached } from "@/services/dashboard/cache";
import { sharedOverview, type SharedBackup, type SharedDatabase, type SharedOverview } from "@/services/tenant/shared-databases";

/**
 * The servers of other tenants that hold databases a tenant has now, as rows of its list of
 * database connections beside its own ones: one row per server, like an own connection, with the
 * databases of it the tenant got. Only the Connections page asks for them, never a picker, the job
 * form or the Database Explorer, since the tenant names them in no job of its own.
 *
 * Nothing of the server reaches a row but its name, its engine and the version of its last check,
 * the schedule of the provider's job that backs it up and the name patterns of the rules that give
 * the tenant its databases. No address, no login, no setting and none of the other databases, so
 * its `config` is empty like the one of a provided destination.
 */

const log = logger.child({ service: "SharedServerRows" });

/** One database of a provided server the tenant holds now. */
export interface ProvidedDatabase {
    /** The database as the Backups page knows it, for Back up now and the restore dialog. */
    database: SharedDatabase;
    /** How many backups of it the tenant has, the ones made while it was theirs. */
    backups: number;
    lastBackup: { at: string; passed: boolean | null } | null;
    /** Its newest backup, null before the first one and for a viewer who may not see backups. */
    newest: SharedBackup | null;
}

/** What the row of a provided server tells beside the fields every connection has. */
export interface SharedServerTerms {
    sourceId: string;
    serverName: string;
    providerName: string;
    /** The databases of it the tenant holds now, by name. */
    databases: ProvidedDatabase[];
    /** Every backup of those databases. */
    backups: number;
    lastBackup: { at: string; passed: boolean | null } | null;
    /** The schedule of the provider's job that backs them up, a cron expression, null while no enabled job does. */
    schedule: string | null;
    /** The name patterns by which the provider gives the tenant every matching database of the server, a new one too. */
    rules: { pattern: string; perDay: number | null }[];
}

export type SharedServerItem = AdapterListItemDTO & { sharedServer: SharedServerTerms };

/** How long the rows of a tenant are kept, like the overview of its own connections. */
const ROWS_TTL_MS = 60_000;

/** The backups on demand that can still change the rows: those of today, with a day to spare for the time zone. */
const STAMP_WINDOW_MS = 36 * 3_600_000;

/** The id of the row of a provided server, which no connection id can take. */
export const sharedServerRowId = (sourceId: string) => `shared:${sourceId}`;

const openNow = (now: Date) => [{ validUntil: null }, { validUntil: { gt: now } }];

/**
 * Whether the tenant may hold a database of another tenant's server now: an assignment or a rule
 * that names it and has not ended. A move ends the assignment it leaves and opens one where the
 * database goes, so that one counts. Two counts, the one cost a tenant without shared databases pays.
 */
export function mayHoldSharedDatabases(tenantId: string, now = new Date()): Promise<boolean> {
    return runAsSystem(async () => {
        const open = { tenantId, OR: openNow(now) };
        const [assignments, rules] = await Promise.all([
            prisma.databaseAssignment.count({ where: open }),
            prisma.databaseAssignmentRule.count({ where: open }),
        ]);
        return assignments + rules > 0;
    });
}

/**
 * What changes the rows between two loads of the cache: the backups the tenant started lately and
 * how their runs stand. A new one, or one that starts or ends, loads the rows again at once.
 */
async function onDemandStamp(tenantId: string, now: Date): Promise<string> {
    return runAsSystem(async () => {
        const requests = await prisma.sharedBackupRequest.findMany({
            where: { tenantId, createdAt: { gte: new Date(now.getTime() - STAMP_WINDOW_MS) } },
            select: { id: true, executionId: true },
            orderBy: { createdAt: "asc" },
        });
        if (requests.length === 0) return "none";
        const runs = await prisma.execution.findMany({
            where: { id: { in: requests.map((request) => request.executionId).filter(Boolean) } },
            select: { id: true, status: true },
        });
        const states = new Map(runs.map((run) => [run.id, run.status]));
        const text = requests.map((request) => `${request.id}:${request.executionId}:${states.get(request.executionId) ?? "-"}`).join(",");
        return createHash("sha256").update(text).digest("hex").slice(0, 16);
    });
}

/** Whether a job backs up a database: it names it, or backs up every database of its server. */
function covers(job: { databases: string }, databaseName: string): boolean {
    try {
        const picked: unknown = JSON.parse(job.databases || "[]");
        return !Array.isArray(picked) || picked.length === 0 || picked.includes(databaseName);
    } catch {
        return true;
    }
}

interface ServerJob {
    sourceId: string | null;
    databases: string;
    enabled: boolean;
    schedule: string;
    schedulePreset: { schedule: string } | null;
}

/** The schedule of the job that backs the databases up, the enabled one first and of them the oldest, like Back up now picks it. */
function scheduleOf(jobs: readonly ServerJob[], sourceId: string, names: readonly string[]): string | null {
    const job = jobs.find((entry) => entry.sourceId === sourceId && entry.enabled && names.some((name) => covers(entry, name)));
    return job ? job.schedulePreset?.schedule ?? job.schedule : null;
}

interface ServerFacts {
    versions: Map<string, string | null>;
    jobs: ServerJob[];
    rules: { sourceId: string; pattern: string; onDemandPerDay: number | null }[];
}

/**
 * The engine version of each server, the jobs that back them up and the rules that give the tenant
 * its databases. Only the version of a server leaves here, and only the pattern of a rule.
 */
function serverFacts(tenantId: string, sourceIds: string[], now: Date): Promise<ServerFacts> {
    return runAsSystem(async () => {
        const [servers, jobs, rules] = await Promise.all([
            prisma.adapterConfig.findMany({ where: { id: { in: sourceIds }, type: "database" }, select: { id: true, metadata: true } }),
            prisma.job.findMany({
                where: { sourceId: { in: sourceIds } },
                select: { sourceId: true, databases: true, enabled: true, schedule: true, schedulePreset: { select: { schedule: true } } },
                orderBy: { createdAt: "asc" },
            }),
            prisma.databaseAssignmentRule.findMany({
                where: { tenantId, sourceId: { in: sourceIds }, OR: openNow(now) },
                select: { sourceId: true, pattern: true, onDemandPerDay: true },
                orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
            }),
        ]);
        return { versions: new Map(servers.map((server) => [server.id, connectionVersion(server.metadata ?? undefined)])), jobs, rules };
    });
}

const latest = (backup: SharedBackup | undefined) => (backup ? { at: backup.createdAt, passed: backup.verification?.passed ?? null } : null);

/** The databases of one server as the row tells them, from the backups the overview read. */
function providedDatabases(databases: readonly SharedDatabase[], overview: SharedOverview): ProvidedDatabase[] {
    return databases.map((database) => {
        const backups = overview.backups.filter((backup) => backup.databaseKey === `${database.sourceId}/${database.databaseName}`);
        return { database, backups: backups.length, lastBackup: latest(backups[0]), newest: backups[0] ?? null };
    });
}

/** One row of the list, with the fields every connection has and nothing of the server behind it. */
export function sharedServerItem(tenantId: string, terms: SharedServerTerms, adapterId: string, version: string | null): SharedServerItem {
    const since = new Date(Math.min(...terms.databases.map(({ database }) => Date.parse(database.since))));
    return {
        id: sharedServerRowId(terms.sourceId),
        name: terms.serverName,
        type: "database",
        adapterId,
        config: "{}",
        secretStatus: {},
        metadata: version ? JSON.stringify({ engineVersion: version }) : null,
        createdAt: since,
        updatedAt: since,
        primaryCredentialId: null,
        sshCredentialId: null,
        defaultRetentionPolicyId: null,
        // The provider checks its server, so the customer sees no check of it.
        lastHealthCheck: null,
        lastStatus: "ONLINE",
        lastError: null,
        consecutiveFailures: 0,
        storageRole: STORAGE_ROLES.DESTINATION,
        supportsBrowse: false,
        tenantId,
        sharedServer: terms,
    };
}

/** The rows of the servers whose databases the tenant holds now, with every backup of their time. */
async function loadRows(tenantId: string, now: Date): Promise<SharedServerItem[]> {
    const overview = await sharedOverview(tenantId, now);
    // A former database and one whose server was deleted only download, on the Backups page.
    const current = overview.databases.filter((database) => database.until === null && !database.serverGone);
    if (current.length === 0) return [];
    const bySource = new Map<string, SharedDatabase[]>();
    for (const database of current) bySource.set(database.sourceId, [...(bySource.get(database.sourceId) ?? []), database]);
    const facts = await serverFacts(tenantId, [...bySource.keys()], now);

    return [...bySource].map(([sourceId, list]) => {
        const databases = providedDatabases([...list].sort((a, b) => a.databaseName.localeCompare(b.databaseName)), overview);
        const keys = new Set(list.map((database) => `${database.sourceId}/${database.databaseName}`));
        const backups = overview.backups.filter((backup) => keys.has(backup.databaseKey));
        const [first] = list;
        return sharedServerItem(tenantId, {
            sourceId,
            serverName: first.serverName,
            providerName: first.providerName,
            databases,
            backups: backups.length,
            lastBackup: latest(backups[0]),
            schedule: scheduleOf(facts.jobs, sourceId, list.map((database) => database.databaseName)),
            rules: facts.rules.filter((rule) => rule.sourceId === sourceId).map((rule) => ({ pattern: rule.pattern, perDay: rule.onDemandPerDay })),
        }, first.adapterId, facts.versions.get(sourceId) ?? null);
    });
}

/**
 * The rows of the servers of other tenants whose databases the tenant holds now, for the
 * Connections page. Kept a minute, since the list asks every few seconds, and loaded again at once
 * when a backup the tenant started begins or ends. `backups` is whether the viewer may see the
 * backups themselves, the newest one of each database is left out otherwise. A failure leaves the
 * rows out, so the tenant's own connections still list.
 */
export async function sharedServerItems(tenantId: string, options: { backups: boolean }, now = new Date()): Promise<SharedServerItem[]> {
    let rows: SharedServerItem[];
    try {
        if (!(await mayHoldSharedDatabases(tenantId, now))) return [];
        const stamp = await onDemandStamp(tenantId, now);
        rows = await cached(`shared-server-rows:${tenantId}:${stamp}`, ROWS_TTL_MS, () => loadRows(tenantId, now));
    } catch (error: unknown) {
        log.warn("Reading the shared databases of a tenant failed", { tenantId }, wrapError(error));
        return [];
    }
    if (options.backups) return rows;
    return rows.map((row) => ({
        ...row,
        sharedServer: { ...row.sharedServer, databases: row.sharedServer.databases.map((entry) => ({ ...entry, newest: null })) },
    }));
}
