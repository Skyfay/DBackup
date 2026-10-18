import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { ownerAt } from "@/lib/tenant/database-owner";
import { cached } from "@/services/dashboard/cache";
import { newestBackupIds, readInChunks } from "@/services/history/newest-runs";
import { parseListed, sharingVersion } from "./shared-servers";

/**
 * What the tenant switcher shows of each tenant: how many jobs and databases it holds, and whether
 * the newest backup of one of its jobs failed or missed a copy. A failure that ran through since
 * needs no look, so the newest run of each job counts, like the dots of History.
 */

/** Failed when the newest backup of a job failed, partial when it missed a copy, null when all is well. */
export type TenantHealth = "failed" | "partial" | null;

export interface TenantSummary {
    id: string;
    jobs: number;
    databases: number;
    /** The databases of the shared servers of other tenants it holds now, by the lists of those servers. None when left out. */
    shared?: number;
    health: TenantHealth;
}

const FINISHED = ["Success", "Failed", "Partial", "Cancelled"];
const TROUBLED = ["Failed", "Partial"];
/**
 * How long the summaries are kept. The switcher, Platform > Tenants and the Overview of All tenants
 * ask for them on every visit, and a run of any tenant ends them early.
 */
const SUMMARIES_TTL_MS = 30_000;

const RULE = { sourceId: true, id: true, pattern: true, tenantId: true, priority: true, validFrom: true, validUntil: true, createdAt: true } as const;
const ASSIGNMENT = { sourceId: true, databaseName: true, tenantId: true, validFrom: true, validUntil: true, movedToSourceId: true, createdAt: true } as const;

/**
 * How many databases each of the tenants holds now on the shared servers of other tenants, of the
 * databases each server listed when it was last read. Every assignment and rule of a server counts,
 * since a name given to one tenant is held by no rule of another. A server whose connection is gone
 * lists nothing, its databases only download.
 */
async function sharedCounts(tenantIds: readonly string[], now: Date): Promise<Map<string, number>> {
    const inTenants = { tenantId: { in: [...tenantIds] } };
    const [given, ruled] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: inTenants, select: { sourceId: true }, distinct: ["sourceId"] }),
        prisma.databaseAssignmentRule.findMany({ where: inTenants, select: { sourceId: true }, distinct: ["sourceId"] }),
    ]);
    const sourceIds = [...new Set([...given, ...ruled].map((row) => row.sourceId))];
    if (sourceIds.length === 0) return new Map();
    const inSources = { sourceId: { in: sourceIds } };
    const [assignments, rules, caches] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: inSources, select: ASSIGNMENT }),
        prisma.databaseAssignmentRule.findMany({ where: inSources, select: RULE }),
        prisma.databaseListCache.findMany({ where: { adapterConfigId: { in: sourceIds } }, select: { adapterConfigId: true, databasesJson: true } }),
    ]);
    const wanted = new Set(tenantIds);
    const counts = new Map<string, number>();
    for (const cache of caches) {
        const ofServer = assignments.filter((assignment) => assignment.sourceId === cache.adapterConfigId);
        const rulesOfServer = rules.filter((rule) => rule.sourceId === cache.adapterConfigId);
        for (const { name } of parseListed(cache.databasesJson)) {
            const tenantId = ownerAt(ofServer, rulesOfServer, name, now);
            if (tenantId && wanted.has(tenantId)) counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
        }
    }
    return counts;
}

/**
 * How many databases each server listed when it was last read, counted by SQLite: a thousand
 * servers of a few hundred databases each are megabytes of lists that only their length is read of.
 * Raw SQL for that reason, it reads the lists of the servers the client found, and only numbers.
 */
async function listedCounts(serverIds: readonly string[]): Promise<Map<string, number>> {
    if (serverIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ id: string; count: number | bigint | null }[]>`
        SELECT c.adapterConfigId AS id,
               CASE WHEN json_valid(c.databasesJson) AND json_type(c.databasesJson) = 'array'
                    THEN json_array_length(c.databasesJson) ELSE 0 END AS count
        FROM DatabaseListCache c
        WHERE c.adapterConfigId IN (SELECT value FROM json_each(${JSON.stringify(serverIds)}))`;
    return new Map(rows.map((row) => [row.id, Number(row.count ?? 0)]));
}

function countBy<T>(rows: readonly T[], tenantOf: (row: T) => string, amount: (row: T) => number = () => 1): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(tenantOf(row), (counts.get(tenantOf(row)) ?? 0) + amount(row));
    return counts;
}

async function loadSummaries(tenantIds: readonly string[]): Promise<Record<string, TenantSummary>> {
    const inTenants = { tenantId: { in: [...tenantIds] } };
    const [jobs, servers, shared] = await Promise.all([
        prisma.job.findMany({ where: inTenants, select: { id: true, tenantId: true } }),
        prisma.adapterConfig.findMany({ where: { ...inTenants, type: "database" }, select: { id: true, tenantId: true } }),
        sharedCounts(tenantIds, new Date()),
    ]);
    const listed = await listedCounts(servers.map((server) => server.id));
    // The newest finished backup of each job, kept where it failed or missed a copy.
    const newest = await newestBackupIds(jobs.map((job) => job.id), { statuses: FINISHED, keepOnly: TROUBLED });
    const runs = await readInChunks(newest, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { tenantId: true, status: true },
    }));
    const troubled = runs.filter((run) => TROUBLED.includes(run.status));

    const jobCounts = countBy(jobs, (job) => job.tenantId);
    const databaseCounts = countBy(servers, (server) => server.tenantId, (server) => listed.get(server.id) ?? 0);
    const health = new Map<string, TenantHealth>();
    for (const run of troubled) {
        if (health.get(run.tenantId) !== "failed") health.set(run.tenantId, run.status === "Failed" ? "failed" : "partial");
    }
    return Object.fromEntries(tenantIds.map((id): [string, TenantSummary] => [id, {
        id,
        jobs: jobCounts.get(id) ?? 0,
        databases: databaseCounts.get(id) ?? 0,
        shared: shared.get(id) ?? 0,
        health: health.get(id) ?? null,
    }]));
}

/**
 * The summaries of the tenants, all at once, in the order of the ids. Kept a short while for the
 * same tenants, in the system scope, whose entries a finished run of any tenant clears, and loaded
 * again at once when a database of a shared server changes hands.
 */
export async function tenantSummaries(tenantIds: readonly string[]): Promise<TenantSummary[]> {
    if (tenantIds.length === 0) return [];
    const ids = [...new Set(tenantIds)].sort();
    const summaries = await runAsSystem(() =>
        cached(`tenant-summaries:v${sharingVersion()}:${ids.join(",")}`, SUMMARIES_TTL_MS, () => loadSummaries(ids)));
    return tenantIds.map((id) => summaries[id]);
}
