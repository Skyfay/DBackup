import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

/**
 * What a tenant holds that a delete takes along: its connections, its jobs, the people working in
 * it, its encryption keys, its API keys and what lies in its Recently deleted.
 */
export interface TenantContents {
    connections: number;
    jobs: number;
    members: number;
    /** Its encryption keys, whose backups only open with a recovery kit once they are gone. */
    keys: number;
    apiKeys: number;
    /** The entries of its Recently deleted, a deleted key among them. */
    deleted: number;
}

/**
 * What a tenant holds now, counted in the system scope. A tenant without any of it is empty, which
 * Delete of several tenants at once asks, since it takes nothing along that someone would miss.
 */
export async function tenantContents(tenantId: string): Promise<TenantContents> {
    return runAsSystem(async () => {
        const where = { tenantId };
        const [connections, jobs, members, keys, apiKeys, deleted] = await Promise.all([
            prisma.adapterConfig.count({ where }),
            prisma.job.count({ where }),
            prisma.tenantMembership.count({ where }),
            prisma.encryptionProfile.count({ where }),
            prisma.apiKey.count({ where }),
            prisma.deletedRecord.count({ where }),
        ]);
        return { connections, jobs, members, keys, apiKeys, deleted };
    });
}

export const isEmptyTenant = (contents: TenantContents) => Object.values(contents).every((count) => count === 0);
