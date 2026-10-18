import prisma from "@/lib/prisma";
import { isPlatformOnly, opensAllTenants, permissionsIn, PLATFORM_PERMISSIONS, reachesTenant, type OwnerMembership, type PlatformGroupGrant } from "@/lib/auth/owner-permissions";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { ALL_TENANTS, HOME_TENANT_ID } from "@/lib/tenant/home";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { tenantNotificationKey } from "@/services/notifications/tenant-notification-settings";
import { logoUrlOf } from "./tenant-logo-service";
import { allowancesOfRow } from "./tenant-allowances";
import type { TenantAllowances } from "@/lib/tenant/allowances";
import { logger } from "@/lib/logging/logger";
import { sharedKindOf, providedTo } from "@/services/sharing/provided";
import { deleteTenantBackups, forgetConnection } from "@/services/sharing/share-cleanup";
import type { Tx } from "@/lib/prisma-tx";
import { sharingChanged } from "./shared-servers";

const log = logger.child({ service: "TenantService" });
import { seedTenantGroups, seedTenantTemplates } from "./tenant-seed";

/** Refuses to delete a tenant while a run of it waits or runs, which a delete would pull away under it. */
async function assertNoActiveRun(client: typeof prisma | Tx, tenantId: string, name: string): Promise<void> {
    const active = await client.execution.count({ where: { tenantId, status: { in: ["Pending", "Running"] } } });
    if (active > 0) throw new ConflictError(`A run of ${name} waits or runs right now. Delete the tenant once it ended, or cancel it first.`);
}

/** The settings of the storage alerts of a destination, as `storage-alert-service.ts` keeps them. */
const alertKeysOf = (destinationId: string) => [`storage.alerts.${destinationId}`, `storage.alerts.${destinationId}.state`];

/** A tenant as the platform lists it, with what it holds. */
export interface TenantRow {
    id: string;
    name: string;
    isHome: boolean;
    /** A tenant of the MSP that shares databases, destinations and channels, see `Tenant.sharesWithCustomers`. */
    sharesWithCustomers: boolean;
    /** Where its logo is served, null without one. */
    logo: string | null;
    members: number;
    connections: number;
    jobs: number;
    createdAt: string;
    /** What it may add itself, which the platform decides. */
    allowances: TenantAllowances;
    /** The destinations and channels other tenants share with it. */
    provided: { destinations: number; channels: number };
    /** The destinations and channels it shares with other tenants. */
    gives: { destinations: number; channels: number };
    /**
     * Backups on demand: how many a day it may start of every database given to it, null for none,
     * and how many databases and rules of now set a number of their own instead.
     */
    onDemand: { perDay: number | null; own: number };
}

/** A tenant someone may switch to, as the head of the sidebar and All tenants show it. */
export interface SwitchableTenant {
    id: string;
    name: string;
    /** Where its logo is served, null without one. */
    logo: string | null;
    /** A tenant of the MSP that shares databases, destinations and channels, see `Tenant.sharesWithCustomers`. */
    sharesWithCustomers: boolean;
    /** The rights to change records the viewer holds there, like `jobs:write`. Left out for a platform admin, who holds every one. */
    writes?: string[];
    /** What it may add itself, which the platform decides. */
    allowances: TenantAllowances;
}

/** The rights to change the records of a tenant someone holds there, without those of the platform. */
function writesIn(memberships: readonly OwnerMembership[], tenantId: string, group: PlatformGroupGrant | null): string[] {
    return permissionsIn(memberships, tenantId, group).filter((permission) => permission.endsWith(":write") && !PLATFORM_PERMISSIONS.has(permission) && !isPlatformOnly(permission));
}

/**
 * A tenant that is gone, or that someone may not open, in a plain sentence. Both read the same,
 * so nobody learns of a tenant they may not see.
 */
class TenantNotOpenError extends NotFoundError {
    constructor(tenantId: string) {
        super("Tenant", tenantId);
        this.message = tenantId === ALL_TENANTS ? "You may not open All tenants." : "The tenant no longer exists, or you may not open it.";
    }
}

/** What deleting a tenant took with it, for the audit log and the answer of the dialog. */
export interface TenantRemoval {
    name: string;
    connections: number;
    jobs: number;
    runs: number;
    keys: number;
}

/** What a customer lost when the tenant that shared a connection with it was deleted, for its audit log. */
export interface WithdrawnByDelete {
    configId: string;
    name: string;
    kind: "destination" | "channel";
    tenantId: string;
    jobs: string[];
    templates: string[];
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
            select: {
                id: true, name: true, sharesWithCustomers: true, createdAt: true, logo: { select: { updatedAt: true } }, _count: { select: { memberships: true } },
                addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true, onDemandPerDay: true,
            },
        });
        // The connections and jobs of every tenant at once, counted by tenant, and what is shared.
        const ownNumber = { validUntil: null, onDemandPerDay: { not: null } };
        const [connections, jobs, shares, ownDatabases, ownRules] = await runAsSystem(async () => Promise.all([
            prisma.adapterConfig.groupBy({ by: ["tenantId"], _count: { _all: true } }),
            prisma.job.groupBy({ by: ["tenantId"], _count: { _all: true } }),
            prisma.connectionShare.findMany({ select: { tenantId: true, allTenants: true, tenants: { select: { tenantId: true } }, config: { select: { type: true, storageRole: true } } } }),
            prisma.databaseAssignment.groupBy({ by: ["tenantId"], where: ownNumber, _count: { _all: true } }),
            prisma.databaseAssignmentRule.groupBy({ by: ["tenantId"], where: ownNumber, _count: { _all: true } }),
        ]));
        const count = (rows: { tenantId: string; _count: { _all: number } }[], id: string) => rows.find((row) => row.tenantId === id)?._count._all ?? 0;
        const sharing = new Set(tenants.filter((tenant) => tenant.sharesWithCustomers).map((tenant) => tenant.id));
        const live = shares.filter((share) => sharing.has(share.tenantId));
        const tally = (tenantId: string, gives: boolean) => {
            const mine = live.filter((share) => gives
                ? share.tenantId === tenantId
                : share.tenantId !== tenantId && (share.allTenants || share.tenants.some((entry) => entry.tenantId === tenantId)));
            return {
                destinations: mine.filter((share) => sharedKindOf(share.config) === "destination").length,
                channels: mine.filter((share) => sharedKindOf(share.config) === "channel").length,
            };
        };
        return tenants
            .map((tenant) => ({
                id: tenant.id,
                name: tenant.name,
                isHome: tenant.id === HOME_TENANT_ID,
                sharesWithCustomers: tenant.sharesWithCustomers,
                logo: logoUrlOf(tenant.id, tenant.logo),
                members: tenant._count.memberships,
                connections: count(connections, tenant.id),
                jobs: count(jobs, tenant.id),
                createdAt: tenant.createdAt.toISOString(),
                allowances: allowancesOfRow(tenant),
                provided: tally(tenant.id, false),
                gives: tally(tenant.id, true),
                onDemand: {
                    perDay: tenant.onDemandPerDay,
                    own: (ownDatabases.find((row) => row.tenantId === tenant.id)?._count._all ?? 0) + count(ownRules, tenant.id),
                },
            }))
            // The home tenant first, it holds what the platform owns.
            .sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name));
    },

    /** How many tenants there are. With one, the pages leave tenants out entirely. */
    async count(): Promise<number> {
        return prisma.tenant.count();
    },

    /**
     * The tenants someone may switch to with their logos: all of them for a platform admin, else
     * their memberships and the tenants of their platform group. Anyone but a platform admin, who
     * may change everything everywhere, gets with each tenant what they may change there, which
     * the New buttons of All tenants offer by.
     */
    async switchable(userId: string, isPlatformAdmin: boolean): Promise<SwitchableTenant[]> {
        const select = {
            id: true, name: true, sharesWithCustomers: true, logo: { select: { updatedAt: true } },
            addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true,
        } as const;
        // A platform group opens every tenant or those of its scope, besides the own memberships.
        const user = isPlatformAdmin
            ? null
            : await prisma.user.findUnique({
                  where: { id: userId },
                  select: {
                      memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
                      platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
                  },
              });
        const group = user?.platformGroup ?? null;
        const everyTenant = isPlatformAdmin || group?.allTenants === true;
        const tenants = everyTenant
            ? await prisma.tenant.findMany({ select })
            : await prisma.tenant.findMany({
                  where: { OR: [{ memberships: { some: { userId } } }, { id: { in: group?.tenants.map((tenant) => tenant.tenantId) ?? [] } }] },
                  select,
              });
        return tenants
            .map((tenant): SwitchableTenant => ({
                id: tenant.id,
                name: tenant.name,
                logo: logoUrlOf(tenant.id, tenant.logo),
                sharesWithCustomers: tenant.sharesWithCustomers,
                ...(isPlatformAdmin ? {} : { writes: writesIn(user?.memberships ?? [], tenant.id, group) }),
                allowances: allowancesOfRow(tenant),
            }))
            .sort((a, b) => Number(b.id === HOME_TENANT_ID) - Number(a.id === HOME_TENANT_ID) || a.name.localeCompare(b.name));
    },

    async find(id: string) {
        return prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    },

    /**
     * Creates a tenant with the built-in templates. Nobody is a member yet, a platform admin sees it
     * anyway. A tenant of the MSP whose servers give databases to customers says so from the start.
     */
    async create(name: string, sharesWithCustomers = false): Promise<{ id: string; name: string }> {
        const clean = cleanName(name);
        await assertFreeName(clean);
        return runAsSystem(() => prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({ data: { name: clean, sharesWithCustomers }, select: { id: true, name: true } });
            await seedTenantTemplates(tx, tenant.id);
            await seedTenantGroups(tx, tenant.id);
            return tenant;
        }));
    },

    /**
     * Switches whether a tenant shares with customers: the databases of its servers, its destinations
     * and its channels. One that gives anything away keeps sharing until it took it back, since
     * without the switch nobody could manage what it gave, and no customer loses anything by a
     * switch. Only servers whose connection exists count, what a deleted one gave ends with the
     * switch. A tenant may share its own and get what another one shares at once.
     */
    async setSharing(id: string, on: boolean, now = new Date()): Promise<{ name: string; changed: boolean }> {
        const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true, sharesWithCustomers: true } });
        if (!tenant) throw new NotFoundError("Tenant", id);
        if (tenant.sharesWithCustomers === on) return { name: tenant.name, changed: false };
        await runAsSystem(async () => {
            if (!on) {
                // Only a server whose connection still exists counts. What a deleted one gave away
                // nobody could take back, since that needs its connection, so it ends with the switch.
                const servers = (await prisma.sharedServer.findMany({ where: { tenantId: id }, select: { id: true } })).map((server) => server.id);
                const live = new Set((await prisma.adapterConfig.findMany({ where: { id: { in: servers }, type: "database" }, select: { id: true } })).map((server) => server.id));
                const liveIds = servers.filter((server) => live.has(server));
                const goneIds = servers.filter((server) => !live.has(server));
                const [given, byRule] = await Promise.all([
                    prisma.databaseAssignment.count({ where: { sourceId: { in: liveIds }, validUntil: null, tenantId: { not: null } } }),
                    prisma.databaseAssignmentRule.count({ where: { sourceId: { in: liveIds }, validUntil: null } }),
                ]);
                if (given + byRule > 0) throw new ValidationError(`${tenant.name} gives databases to other tenants. Take them back and end its rules first.`);
                const connections = await prisma.connectionShare.count({ where: { tenantId: id } });
                if (connections > 0) throw new ValidationError(`${tenant.name} shares destinations or channels with other tenants. Stop sharing them first.`);
                await prisma.$transaction([
                    prisma.databaseAssignment.updateMany({ where: { sourceId: { in: goneIds }, validUntil: null, tenantId: { not: null } }, data: { validUntil: now } }),
                    prisma.databaseAssignmentRule.updateMany({ where: { sourceId: { in: goneIds }, validUntil: null }, data: { validUntil: now } }),
                    prisma.tenant.update({ where: { id }, data: { sharesWithCustomers: on } }),
                ]);
                return;
            }
            await prisma.tenant.update({ where: { id }, data: { sharesWithCustomers: on } });
        });
        sharingChanged();
        return { name: tenant.name, changed: true };
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
     * tenant is never deleted, and no tenant while a run of it waits or runs.
     *
     * The databases of shared servers it held end with it, but its assignments and rules stay with
     * its id: the backups of its time belong to nobody from then on, never to whoever another rule
     * names, see `holderAt` in `database-owner.ts`. A database it held by name is taken back, so no
     * rule of another tenant takes it from then on either.
     */
    async delete(id: string, now = new Date()): Promise<TenantRemoval & { withdrawn: WithdrawnByDelete[] }> {
        if (id === HOME_TENANT_ID) throw new ValidationError("The home tenant holds what the platform owns and cannot be deleted.");
        const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
        if (!tenant) throw new NotFoundError("Tenant", id);
        // A run that waits or runs would lose its row under its feet and leave its followers waiting.
        await runAsSystem(() => assertNoActiveRun(prisma, id, tenant.name));

        // What it shares goes with its connections, so its customers lose every link to them first.
        // Their backups stay on the storage, which deleting a tenant never touches.
        const given = await runAsSystem(() => prisma.connectionShare.findMany({ where: { tenantId: id }, select: { id: true, allTenants: true, tenants: { select: { tenantId: true } }, config: { select: { name: true, type: true, storageRole: true } } } }));
        const withdrawn: WithdrawnByDelete[] = [];
        if (given.length > 0) {
            const everyone = (await prisma.tenant.findMany({ where: { id: { not: id } }, select: { id: true } })).map((other) => other.id);
            for (const share of given) {
                const kind = sharedKindOf(share.config);
                if (!kind) continue;
                const losses = await forgetConnection(share.id, kind, share.allTenants ? everyone : share.tenants.map((entry) => entry.tenantId), false);
                withdrawn.push(...losses.map((loss) => ({ configId: share.id, name: share.config.name, kind, tenantId: loss.tenantId, jobs: loss.jobs, templates: loss.templates })));
            }
        }
        // Its own backups on destinations other tenants shared with it go once it is gone.
        const borrowed = await providedTo(id, { kind: "destination" });

        const removal = await runAsSystem(() => prisma.$transaction(async (tx) => {
            const where = { tenantId: id };
            // Once more inside, since a run may have started while its customers lost what it shared.
            await assertNoActiveRun(tx, id, tenant.name);
            // Children before what they point to: the runs and jobs hold the connections and keys.
            const runs = await tx.execution.deleteMany({ where });
            const jobs = await tx.job.deleteMany({ where });
            await tx.notificationTemplate.deleteMany({ where });
            // Only a destination has storage alerts.
            const destinations = await tx.adapterConfig.findMany({ where: { ...where, type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, select: { id: true } });
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
            // What other tenants share with it: their names for it, its recipients and its listings.
            await tx.connectionShareTenant.deleteMany({ where: { tenantId: id } });
            // A channel it was the last tenant of is shared no longer. A destination waits until its
            // backups there are gone, so its tenant never sees them, see below.
            await tx.connectionShare.deleteMany({ where: { allTenants: false, tenants: { none: {} }, config: { type: "notification" } } });
            await tx.channelRecipients.deleteMany({ where });
            await tx.storageListCache.deleteMany({ where });
            // What it held of other tenants' servers ends now and keeps its id for the time before. A
            // database it held by name is taken back like with Nobody else, so it belongs to the tenant
            // of its server alone from now on and never falls to another tenant's rule.
            const held = await tx.databaseAssignment.findMany({ where: { tenantId: id, validUntil: null }, select: { sourceId: true, databaseName: true } });
            await tx.databaseAssignment.updateMany({ where: { tenantId: id, validUntil: null }, data: { validUntil: now } });
            if (held.length > 0) {
                await tx.databaseAssignment.createMany({
                    data: held.map((assignment) => ({ sourceId: assignment.sourceId, databaseName: assignment.databaseName, tenantId: null, validFrom: now, createdAt: now })),
                });
            }
            await tx.databaseAssignmentRule.updateMany({ where: { tenantId: id, validUntil: null }, data: { validUntil: now } });
            // Its settings kept by key: its own notifications and the alerts of its destinations.
            await tx.systemSetting.deleteMany({
                where: { key: { in: [tenantNotificationKey(id), ...destinations.flatMap((destination) => alertKeysOf(destination.id))] } },
            });
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
        sharingChanged();
        const { scheduler } = await import("@/lib/server/scheduler");
        await scheduler.refresh();
        // The storage may take a while, so the answer does not wait for it. A destination it was the
        // last tenant of is shared no longer once its backups there are gone.
        for (const destination of borrowed) {
            void deleteTenantBackups(destination.id, id)
                .then(() => runAsSystem(() => prisma.connectionShare.deleteMany({ where: { id: destination.id, allTenants: false, tenants: { none: {} } } })))
                .catch((error: unknown) =>
                    log.warn("Could not delete the backups of a deleted tenant on a shared destination", { configId: destination.id, tenantId: id }, wrapError(error)));
        }
        return { ...removal, withdrawn };
    },

    /**
     * Makes a session work in a tenant and says which one applies. A platform admin may pick any
     * tenant there is and All tenants, a member their tenants, and a platform group the tenants of
     * its scope, and All tenants when it opens it. Anyone else may not. All tenants needs a second
     * tenant, like `pickTenant`, so with one left the session works in the home tenant.
     */
    async setActive(sessionId: string, userId: string, tenantId: string, isPlatformAdmin: boolean): Promise<{ id: string; name: string }> {
        // The platform group of the account as its rights read it, the same rules the session follows.
        const group = isPlatformAdmin
            ? null
            : (await prisma.user.findUnique({
                  where: { id: userId },
                  select: { platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } } },
              }))?.platformGroup ?? null;
        let wanted = tenantId;
        if (wanted === ALL_TENANTS) {
            if (!isPlatformAdmin && !opensAllTenants(group)) throw new TenantNotOpenError(wanted);
            if ((await prisma.tenant.count()) > 1) {
                await prisma.session.update({ where: { id: sessionId }, data: { activeTenantId: ALL_TENANTS } });
                return { id: ALL_TENANTS, name: "All tenants" };
            }
            wanted = HOME_TENANT_ID;
        }
        const tenant = await prisma.tenant.findUnique({ where: { id: wanted }, select: { name: true } });
        const member = isPlatformAdmin
            || reachesTenant(group, wanted)
            || (await prisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId, tenantId: wanted } }, select: { tenantId: true } }));
        // A tenant someone may not open reads the same as one that does not exist.
        if (!tenant || !member) throw new TenantNotOpenError(wanted);
        await prisma.session.update({ where: { id: sessionId }, data: { activeTenantId: wanted } });
        return { id: wanted, name: tenant.name };
    },
};
