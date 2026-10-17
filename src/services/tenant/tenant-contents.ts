import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

/** What a tenant holds that a delete takes along: its connections, its jobs and the people working in it. */
export interface TenantContents {
    connections: number;
    jobs: number;
    members: number;
}

/**
 * What a tenant holds now, counted in the system scope. A tenant without any of it is empty, which
 * Delete of several tenants at once asks, since it takes nothing along that someone would miss.
 */
export async function tenantContents(tenantId: string): Promise<TenantContents> {
    return runAsSystem(async () => {
        const [connections, jobs, members] = await Promise.all([
            prisma.adapterConfig.count({ where: { tenantId } }),
            prisma.job.count({ where: { tenantId } }),
            prisma.tenantMembership.count({ where: { tenantId } }),
        ]);
        return { connections, jobs, members };
    });
}

export const isEmptyTenant = (contents: TenantContents) => contents.connections === 0 && contents.jobs === 0 && contents.members === 0;
