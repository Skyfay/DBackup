import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

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

/** The summaries of the tenants, all at once, in the order of the ids. */
export function tenantSummaries(tenantIds: readonly string[]): Promise<TenantSummary[]> {
    if (tenantIds.length === 0) return Promise.resolve([]);
    return runAsSystem(async () => {
        const inTenants = { tenantId: { in: [...tenantIds] } };
        const [jobs, caches, newest] = await Promise.all([
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
                health: runs.some((run) => run.status === "Failed") ? "failed" : runs.length > 0 ? "partial" : null,
            };
        });
    });
}
