import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { currentTenantId } from "@/lib/tenant/current";
import { providedTo } from "@/services/sharing/provided";

/**
 * True while the instance has nothing to back up: no database, no directory source, no
 * destination and no job. Notification channels do not count, a channel alone backs up nothing.
 */
export async function hasNothingToBackUp(): Promise<boolean> {
    const [connections, jobs] = await Promise.all([
        prisma.adapterConfig.count({ where: { type: { in: ["database", "storage"] } } }),
        prisma.job.count(),
    ]);
    return connections === 0 && jobs === 0;
}

/** What the tenant that runs now can back up with jobs of its own. */
export interface OwnBackupReach {
    /**
     * It has or may add something to back up, a database or a directory source, and a place for the
     * backups, a destination of its own or one another tenant shares with it. A customer whose
     * databases another tenant backs up, and who adds none itself, has nothing for a job of its own.
     */
    jobs: boolean;
    /** It has or may add a database connection, the only thing the Database Explorer reads. */
    databases: boolean;
}

/**
 * What the tenant that runs now can back up itself, from what it has and what the platform lets it
 * add. Outside a tenant, like in All tenants, everything counts.
 */
export async function ownBackupReach(): Promise<OwnBackupReach> {
    const tenantId = await currentTenantId();
    if (!tenantId) return { jobs: true, databases: true };
    const [tenant, databases, folders, destinations] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { addsDatabases: true, addsDirectorySources: true, addsDestinations: true } }),
        prisma.adapterConfig.count({ where: { type: "database" } }),
        prisma.adapterConfig.count({ where: { type: "storage", storageRole: STORAGE_ROLES.SOURCE } }),
        prisma.adapterConfig.count({ where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION } }),
    ]);
    const mayAdd = tenant ?? { addsDatabases: true, addsDirectorySources: true, addsDestinations: true };
    const hasDatabases = databases > 0 || mayAdd.addsDatabases;
    const hasSources = hasDatabases || folders > 0 || mayAdd.addsDirectorySources;
    // Only asked when the tenant has no destination of its own and may add none.
    const hasDestinations = destinations > 0 || mayAdd.addsDestinations || (hasSources && (await providedTo(tenantId, { kind: "destination" })).length > 0);
    return { jobs: hasSources && hasDestinations, databases: hasDatabases };
}

/**
 * Whether the sidebar offers Quick Setup: while no database is set up, or always once General
 * says so.
 */
export async function showsQuickSetup(): Promise<boolean> {
    const [databases, setting] = await Promise.all([
        prisma.adapterConfig.count({ where: { type: "database" } }),
        prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" }, select: { value: true } }),
    ]);
    return setting?.value === "true" || databases === 0;
}
