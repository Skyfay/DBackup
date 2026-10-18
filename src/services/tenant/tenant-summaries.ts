import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { ownerAt } from "@/lib/tenant/database-owner";
import { parseListed } from "./shared-servers";

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

/** How many databases a server held when it was last read. */
function listedCount(json: string): number {
    try {
        const value: unknown = JSON.parse(json);
        return Array.isArray(value) ? value.length : 0;
    } catch {
        return 0;
    }
}

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

/** The summaries of the tenants, all at once, in the order of the ids. */
export function tenantSummaries(tenantIds: readonly string[]): Promise<TenantSummary[]> {
    if (tenantIds.length === 0) return Promise.resolve([]);
    return runAsSystem(async () => {
        const inTenants = { tenantId: { in: [...tenantIds] } };
        const [jobs, caches, newest, shared] = await Promise.all([
            prisma.job.groupBy({ by: ["tenantId"], where: inTenants, _count: { _all: true } }),
            prisma.databaseListCache.findMany({
                where: { adapterConfig: { ...inTenants, type: "database" } },
                select: { databasesJson: true, adapterConfig: { select: { tenantId: true } } },
            }),
            prisma.execution.groupBy({
                by: ["jobId"],
                where: { ...inTenants, jobId: { not: null }, type: "Backup", status: { in: FINISHED } },
                _max: { startedAt: true },
            }),
            sharedCounts(tenantIds, new Date()),
        ]);
        const troubled = newest.length === 0
            ? []
            : await prisma.execution.findMany({
                  where: {
                      type: "Backup",
                      status: { in: ["Failed", "Partial"] },
                      OR: newest.map((row) => ({ jobId: row.jobId, startedAt: row._max.startedAt ?? undefined })),
                  },
                  select: { tenantId: true, status: true },
              });

        return tenantIds.map((id): TenantSummary => {
            const runs = troubled.filter((run) => run.tenantId === id);
            return {
                id,
                jobs: jobs.find((row) => row.tenantId === id)?._count._all ?? 0,
                databases: caches.filter((cache) => cache.adapterConfig.tenantId === id).reduce((sum, cache) => sum + listedCount(cache.databasesJson), 0),
                shared: shared.get(id) ?? 0,
                health: runs.some((run) => run.status === "Failed") ? "failed" : runs.length > 0 ? "partial" : null,
            };
        });
    });
}
