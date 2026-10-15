import prisma from "@/lib/prisma";
import { opensAllTenants, reachesTenant } from "@/lib/auth/owner-permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { ALL_TENANTS, HOME_TENANT_ID } from "@/lib/tenant/home";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { logoUrlOf } from "./tenant-logo-service";
import { seedTenantGroups, seedTenantTemplates } from "./tenant-seed";

/** A tenant as the platform lists it, with what it holds. */
export interface TenantRow {
    id: string;
    name: string;
    isHome: boolean;
    /** Where its logo is served, null without one. */
    logo: string | null;
    members: number;
    connections: number;
    jobs: number;
    createdAt: string;
}

/** What deleting a tenant took with it, for the audit log and the answer of the dialog. */
export interface TenantRemoval {
    name: string;
    connections: number;
    jobs: number;
    runs: number;
    keys: number;
}

const NAME_MAX = 60;

function cleanName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Give the tenant a name.");
    if (trimmed.length > NAME_MAX) throw new ValidationError(`The name can have at most ${NAME_MAX} characters.`);
    return trimmed;
}

async function assertFreeName(name: string, exceptId?: string): Promise<void> {
    const clash = await prisma.tenant.findUnique({ where: { name }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ConflictError(`A tenant named "${name}" exists already.`);
}

export const tenantService = {
    /** Every tenant with its numbers, for the platform. */
    async list(): Promise<TenantRow[]> {
        const tenants = await prisma.tenant.findMany({
            orderBy: { name: "asc" },
            select: { id: true, name: true, createdAt: true, logo: { select: { updatedAt: true } }, _count: { select: { memberships: true } } },
        });
        // The connections and jobs of every tenant at once, counted by tenant.
        const [connections, jobs] = await runAsSystem(async () => Promise.all([
            prisma.adapterConfig.groupBy({ by: ["tenantId"], _count: { _all: true } }),
            prisma.job.groupBy({ by: ["tenantId"], _count: { _all: true } }),
        ]));
        const count = (rows: { tenantId: string; _count: { _all: number } }[], id: string) => rows.find((row) => row.tenantId === id)?._count._all ?? 0;
        return tenants
            .map((tenant) => ({
                id: tenant.id,
                name: tenant.name,
                isHome: tenant.id === HOME_TENANT_ID,
                logo: logoUrlOf(tenant.id, tenant.logo),
                members: tenant._count.memberships,
                connections: count(connections, tenant.id),
                jobs: count(jobs, tenant.id),
                createdAt: tenant.createdAt.toISOString(),
            }))
            // The home tenant first, it holds what the platform owns.
            .sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name));
    },

    /** How many tenants there are. With one, the pages leave tenants out entirely. */
    async count(): Promise<number> {
        return prisma.tenant.count();
    },

    /** The tenants someone may switch to with their logos: all of them for a platform admin, else their memberships. */
    async switchable(userId: string, isPlatformAdmin: boolean): Promise<{ id: string; name: string; logo: string | null }[]> {
        const select = { id: true, name: true, logo: { select: { updatedAt: true } } } as const;
        // A platform group opens every tenant or those of its scope, besides the own memberships.
        const group = isPlatformAdmin
            ? null
            : (await prisma.user.findUnique({ where: { id: userId }, select: { platformGroup: { select: { allTenants: true, tenants: { select: { tenantId: true } } } } } }))?.platformGroup;
        const everyTenant = isPlatformAdmin || group?.allTenants === true;
        const tenants = everyTenant
            ? await prisma.tenant.findMany({ select })
            : await prisma.tenant.findMany({
                  where: { OR: [{ memberships: { some: { userId } } }, { id: { in: group?.tenants.map((tenant) => tenant.tenantId) ?? [] } }] },
                  select,
              });
        return tenants
            .map((tenant) => ({ id: tenant.id, name: tenant.name, logo: logoUrlOf(tenant.id, tenant.logo) }))
            .sort((a, b) => Number(b.id === HOME_TENANT_ID) - Number(a.id === HOME_TENANT_ID) || a.name.localeCompare(b.name));
    },

    async find(id: string) {
        return prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    },

    /** Creates a tenant with the built-in templates. Nobody is a member yet, a platform admin sees it anyway. */
    async create(name: string): Promise<{ id: string; name: string }> {
        const clean = cleanName(name);
        await assertFreeName(clean);
        return runAsSystem(() => prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({ data: { name: clean }, select: { id: true, name: true } });
            await seedTenantTemplates(tx, tenant.id);
            await seedTenantGroups(tx, tenant.id);
            return tenant;
        }));
    },

    async rename(id: string, name: string): Promise<{ name: string; renamedFrom: string }> {
        const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
        if (!tenant) throw new NotFoundError("Tenant", id);
        const clean = cleanName(name);
        await assertFreeName(clean, id);
        await prisma.tenant.update({ where: { id }, data: { name: clean } });
        return { name: clean, renamedFrom: tenant.name };
    },

    /**
     * Deletes a tenant with everything it holds: its connections, jobs, runs, keys, logins,
     * templates, API keys and logs, and the memberships in it. The backups at its destinations stay
     * where they are, and an account that worked only there stays without a tenant. The home
     * tenant is never deleted.
     */
    async delete(id: string): Promise<TenantRemoval> {
        if (id === HOME_TENANT_ID) throw new ValidationError("The home tenant holds what the platform owns and cannot be deleted.");
        const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
        if (!tenant) throw new NotFoundError("Tenant", id);

        const removal = await runAsSystem(() => prisma.$transaction(async (tx) => {
            const where = { tenantId: id };
            // Children before what they point to: the runs and jobs hold the connections and keys.
            const runs = await tx.execution.deleteMany({ where });
            const jobs = await tx.job.deleteMany({ where });
            await tx.notificationTemplate.deleteMany({ where });
            const connections = await tx.adapterConfig.deleteMany({ where });
            await tx.credentialProfile.deleteMany({ where });
            const keys = await tx.encryptionProfile.deleteMany({ where });
            await tx.retentionPolicy.deleteMany({ where });
            await tx.namingTemplate.deleteMany({ where });
            await tx.schedulePreset.deleteMany({ where });
            await tx.excludePatternPreset.deleteMany({ where });
            await tx.apiKey.deleteMany({ where });
            await tx.auditLog.deleteMany({ where });
            await tx.notificationLog.deleteMany({ where });
            await tx.storageSnapshot.deleteMany({ where });
            await tx.deletedRecord.deleteMany({ where });
            // Its shared servers with what they gave away, and the backups it started of databases given to it.
            await tx.sharedServer.deleteMany({ where });
            await tx.sharedBackupRequest.deleteMany({ where });
            // A session that worked in it picks another tenant on its next request.
            await tx.session.updateMany({ where: { activeTenantId: id }, data: { activeTenantId: null } });
            // Its sign-in providers go with it, the accounts they made stay. Their links go too, like
            // when one provider is deleted, so a new provider under an old ID never signs anyone in
            // through a link nobody made with it.
            const providers = await tx.ssoProvider.findMany({ where, select: { providerId: true } });
            if (providers.length > 0) await tx.account.deleteMany({ where: { providerId: { in: providers.map((provider) => provider.providerId) } } });
            await tx.ssoProvider.deleteMany({ where });
            // The memberships and invitations go with the tenant, its groups after them.
            await tx.tenant.delete({ where: { id } });
            await tx.group.deleteMany({ where });
            return { name: tenant.name, connections: connections.count, jobs: jobs.count, runs: runs.count, keys: keys.count };
        }, { timeout: 120_000 }));

        invalidateDashboardCache();
        const { scheduler } = await import("@/lib/server/scheduler");
        await scheduler.refresh();
        return removal;
    },

    /**
     * Makes a session work in a tenant. A platform admin may pick any tenant there is and All
     * tenants, a member their tenants, and a platform group the tenants of its scope, and All tenants
     * when it opens it. Anyone else may not.
     */
    async setActive(sessionId: string, userId: string, tenantId: string, isPlatformAdmin: boolean): Promise<{ name: string }> {
        // The platform group of the account as its rights read it, the same rules the session follows.
        const group = isPlatformAdmin
            ? null
            : (await prisma.user.findUnique({
                  where: { id: userId },
                  select: { platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } } },
              }))?.platformGroup ?? null;
        if (tenantId === ALL_TENANTS) {
            if (!isPlatformAdmin && !opensAllTenants(group)) throw new NotFoundError("Tenant", tenantId);
            await prisma.session.update({ where: { id: sessionId }, data: { activeTenantId: ALL_TENANTS } });
            return { name: "All tenants" };
        }
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const member = isPlatformAdmin
            || reachesTenant(group, tenantId)
            || (await prisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId, tenantId } }, select: { tenantId: true } }));
        // A tenant someone may not open reads the same as one that does not exist.
        if (!tenant || !member) throw new NotFoundError("Tenant", tenantId);
        await prisma.session.update({ where: { id: sessionId }, data: { activeTenantId: tenantId } });
        return { name: tenant.name };
    },
};
