import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { groupPermissions, PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * The accounts a tenant lists: its members, and in the home tenant also the accounts of no tenant,
 * so someone can give them a role. With one tenant these are all accounts, like before tenants.
 */
export function peopleOf(tenantId: string): Prisma.UserWhereInput {
    return tenantId === HOME_TENANT_ID
        ? { OR: [{ memberships: { some: { tenantId } } }, { memberships: { none: {} } }] }
        : { memberships: { some: { tenantId } } };
}

/** The membership of an account in one tenant, as a select that leaves the others out. */
export function roleIn(tenantId: string) {
    return {
        where: { tenantId },
        select: { group: { select: { id: true, name: true, permissions: true, fullAccess: true } } },
    } as const;
}

/** Whether a role lets its holder manage the members of a tenant. */
const managesMembers = (group: { permissions: string; fullAccess: boolean }) => groupPermissions(group).includes(PERMISSIONS.USERS.WRITE);

/**
 * Who changes a membership or a group. A platform admin manages every tenant whoever is in it, so
 * the guard that keeps someone who manages the members of a tenant does not bind them: they may
 * leave a tenant with nobody who does, or with no members at all.
 */
export interface MembershipActor {
    platformAdmin: boolean;
}

/** Someone who works in a tenant, as the platform lists them. */
export interface TenantMember {
    id: string;
    name: string;
    email: string;
    image: string | null;
    group: { id: string; name: string };
    platformAdmin: boolean;
}

export const membershipService = {
    /** The members of a tenant with their group there, by name. */
    async members(tenantId: string): Promise<TenantMember[]> {
        const memberships = await prisma.tenantMembership.findMany({
            where: { tenantId },
            select: {
                group: { select: { id: true, name: true } },
                user: { select: { id: true, name: true, email: true, image: true, platformRole: true } },
            },
        });
        return memberships
            .map(({ user, group }) => ({ id: user.id, name: user.name, email: user.email, image: user.image, group, platformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE }))
            .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Every account of the instance, for a platform admin who adds one to a tenant. */
    async accounts(): Promise<{ id: string; name: string; email: string; platformAdmin: boolean }[]> {
        const users = await prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, platformRole: true } });
        return users.map((user) => ({ id: user.id, name: user.name, email: user.email, platformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE }));
    },

    /**
     * Whether an account is one of the people of a tenant, see `peopleOf`: a member there, or in the
     * home tenant an account of no tenant. Only these get a group of the tenant from its own admins,
     * anyone else joins through an invitation, or by whoever manages the tenants.
     */
    async isPersonOf(userId: string, tenantId: string): Promise<boolean> {
        return (await prisma.user.count({ where: { AND: [{ id: userId }, peopleOf(tenantId)] } })) > 0;
    },

    /** The tenants an account works in. */
    async tenantsOf(userId: string): Promise<string[]> {
        const memberships = await prisma.tenantMembership.findMany({ where: { userId }, select: { tenantId: true } });
        return memberships.map((membership) => membership.tenantId);
    },

    /** The role of an account in a tenant, null without a membership. */
    async roleOf(userId: string, tenantId: string) {
        const membership = await prisma.tenantMembership.findUnique({
            where: { userId_tenantId: { userId, tenantId } },
            select: { group: { select: { id: true, name: true, permissions: true, fullAccess: true } } },
        });
        return membership?.group ?? null;
    },

    /** Whether the account sees and changes every tenant and the platform. */
    async isPlatformAdmin(userId: string): Promise<boolean> {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
        return user?.platformRole === PLATFORM_ADMIN_ROLE;
    },

    /** The platform admins among these accounts, with the name to report them by. */
    async platformAdminsAmong(userIds: string[]) {
        const users = await prisma.user.findMany({
            where: { id: { in: userIds }, platformRole: PLATFORM_ADMIN_ROLE },
            select: { id: true, name: true, email: true },
        });
        return users.map((user) => ({ id: user.id, name: user.name || user.email }));
    },

    /**
     * Gives an account a role in a tenant, or ends its membership there with null. Refused when the
     * tenant would be left without anyone who manages its members, since then nobody but a platform
     * admin could add one again, unless a platform admin makes the change.
     */
    async setRole(userId: string, tenantId: string, groupId: string | null, by: MembershipActor): Promise<void> {
        // In the tenant of the membership, so only a group of that tenant is found.
        await runAsTenant(tenantId, () => prisma.$transaction(async (tx) => {
            const [user, group, current] = await Promise.all([
                tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
                groupId ? tx.group.findUnique({ where: { id: groupId }, select: { permissions: true, fullAccess: true } }) : null,
                tx.tenantMembership.findUnique({ where: { userId_tenantId: { userId, tenantId } }, select: { group: { select: { permissions: true, fullAccess: true } } } }),
            ]);
            if (!user) throw new NotFoundError("User", userId);
            if (groupId && !group) throw new ValidationError("The group no longer exists.");

            if (!by.platformAdmin && current && managesMembers(current.group) && !(group && managesMembers(group))) {
                const managers = await tx.tenantMembership.findMany({
                    where: { tenantId, userId: { not: userId } },
                    select: { group: { select: { permissions: true, fullAccess: true } } },
                });
                if (!managers.some((membership) => managesMembers(membership.group))) {
                    throw new ValidationError("Nobody else manages the members of this tenant. Give someone that right first.");
                }
            }

            if (groupId) {
                await tx.tenantMembership.upsert({
                    where: { userId_tenantId: { userId, tenantId } },
                    create: { userId, tenantId, groupId },
                    update: { groupId },
                });
            } else if (current) {
                await tx.tenantMembership.delete({ where: { userId_tenantId: { userId, tenantId } } });
                // A session that worked there picks another tenant on its next request, and does not
                // come back there by itself should the account be added again.
                await tx.session.updateMany({ where: { userId, activeTenantId: tenantId }, data: { activeTenantId: null } });
            }
        }));
    },

    /** Gives several accounts a role in a tenant, or ends their memberships, each on its own. */
    async setRoles(userIds: string[], tenantId: string, groupId: string | null, by: MembershipActor): Promise<BulkResult> {
        const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
        const names = new Map(users.map((user) => [user.id, user.name || user.email]));
        return runBulk(userIds, (id) => this.setRole(id, tenantId, groupId, by), (id) => names.get(id));
    },

    /**
     * Makes an account a platform admin or takes it back. The last platform admin stays one, since
     * nobody else could manage the tenants and the sign-in providers. A platform admin holds no
     * platform group besides, so making one clears it.
     */
    async setPlatformAdmin(userId: string, on: boolean): Promise<void> {
        await prisma.$transaction(async (tx) => {
            if (!on) {
                const others = await tx.user.count({ where: { platformRole: PLATFORM_ADMIN_ROLE, id: { not: userId } } });
                if (others === 0) throw new ValidationError("The last platform admin stays one.");
            }
            await tx.user.update({ where: { id: userId }, data: on ? { platformRole: PLATFORM_ADMIN_ROLE, platformGroupId: null } : { platformRole: null } });
        });
    },
};
