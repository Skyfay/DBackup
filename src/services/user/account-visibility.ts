import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { hasPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import type { ImageType } from "@/lib/core/image-type";
import { runAsTenant } from "@/lib/tenant/context";
import { membersOfAny, membershipService, peopleOf } from "@/services/tenant/membership-service";
import { platformGroupService } from "./platform-group-service";

/**
 * Who sees which account. An account belongs to no tenant, so the tenant filter never narrows a
 * lookup of one by an id from the request, and these decide whether the caller may see it. Anyone
 * else gets the answer of an account that does not exist.
 */

export type AccountViewer = Pick<AuthContext, "userId" | "tenantId" | "allTenants" | "isPlatformAdmin" | "permissions">;

/** The platform rights whose pages list the people of the sign-in providers by name. */
const LISTS_PEOPLE = [PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.SETTINGS.READ] as const;

/** Whether the viewer may see or manage the accounts of the platform. */
const holdsAccountRights = (viewer: AccountViewer) =>
    hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.ACCOUNTS_READ) || hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);

/**
 * The tenants whose people the viewer sees through the right to see or manage the accounts of the
 * platform. Every tenant for a platform admin, for a platform group of all tenants and in All
 * tenants, whose Users tab lists every account of the instance. The tenants of the platform group
 * for a group of some tenants, and none without the right.
 */
export async function accountsSeenReach(viewer: AccountViewer): Promise<PlatformReach> {
    if (viewer.isPlatformAdmin || viewer.allTenants) return "all";
    return holdsAccountRights(viewer) ? platformGroupService.reachOf(viewer.userId) : [];
}

/** Whether a reach sees an account: every one, else one with a membership in a tenant of it, see `membersOfAny`. */
async function reachSees(reach: PlatformReach, userId: string): Promise<boolean> {
    if (reach === "all") return true;
    if (reach.length === 0) return false;
    return (await prisma.user.count({ where: { AND: [{ id: userId }, membersOfAny(reach)] } })) > 0;
}

/**
 * The tenants whose people the viewer sees by the pages that list the people of the sign-in
 * providers: the reach of their platform group, every tenant for a platform admin and for whoever
 * reads the settings through their group of the home tenant without a platform group, as before
 * there were platform groups.
 */
async function signInPeopleReach(viewer: AccountViewer): Promise<PlatformReach> {
    if (viewer.isPlatformAdmin || viewer.allTenants) return "all";
    if (!LISTS_PEOPLE.some((permission) => hasPermissionWithContext(viewer, permission))) return [];
    const own = await platformGroupService.shapeOf(viewer.userId);
    if (!own) return "all";
    return own.shape.allTenants ? "all" : own.shape.tenantIds;
}

/**
 * Whether whoever may see the tenants sees an account among their members: the Tenants page lists
 * the members of the tenants their platform group reaches, every tenant for a group of all tenants.
 */
async function amongTenantMembers(viewer: AccountViewer, userId: string): Promise<boolean> {
    if (!hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_READ)) return false;
    if (await platformGroupService.reachesAll(viewer.userId)) return true;
    return (await platformGroupService.peopleReached(viewer.userId)).includes(userId);
}

/** The people of the MSP who open a tenant through the platform, see `platformPeopleOf`. */
function reachesTenant(tenantId: string): Prisma.UserWhereInput {
    return {
        OR: [
            { platformRole: PLATFORM_ADMIN_ROLE },
            { platformGroup: { OR: [{ allTenants: true }, { tenants: { some: { tenantId } } }] } },
        ],
    };
}

/**
 * Whether the viewer may open the panel of an account, with its sessions, their addresses and its
 * sign-in methods: their own, one the Users tab of the tenant they work in lists, or one the
 * accounts of the platform show them, see `accountsSeenReach`.
 */
export async function maySeeAccount(viewer: AccountViewer, userId: string): Promise<boolean> {
    if (viewer.userId === userId) return true;
    if (await reachSees(await accountsSeenReach(viewer), userId)) return true;
    return viewer.tenantId ? membershipService.isPersonOf(userId, viewer.tenantId) : false;
}

/**
 * Whether the viewer may see the picture of an account, which shows beside its name wherever the
 * name shows: the accounts of `maySeeAccount`, the people of the sign-in providers they see, the
 * people of the platform who open the tenant, and whoever acted in it, in its audit log or as the
 * owner of one of its API keys.
 */
export async function maySeePicture(viewer: AccountViewer, userId: string): Promise<boolean> {
    if (viewer.userId === userId) return true;
    if (await reachSees(await accountsSeenReach(viewer), userId)) return true;
    if (await reachSees(await signInPeopleReach(viewer), userId)) return true;
    if (await amongTenantMembers(viewer, userId)) return true;
    const tenantId = viewer.tenantId;
    if (!tenantId) return false;

    const known = await prisma.user.count({ where: { AND: [{ id: userId }, { OR: [peopleOf(tenantId), reachesTenant(tenantId)] }] } });
    if (known > 0) return true;
    // Read in the tenant of the viewer, the filter leaves the entries and keys of the others out.
    const [entries, keys] = await runAsTenant(tenantId, () => Promise.all([
        prisma.auditLog.count({ where: { userId } }),
        prisma.apiKey.count({ where: { userId } }),
    ]));
    return entries + keys > 0;
}

/** File names of the versions that kept pictures as files, like `<id>-1727000000000.png`, which a session may still hold. */
const LEGACY_NAME = /^(.+)-\d{10,}(\.[a-z0-9]+)?$/i;

/**
 * The picture a part of its address names, when the viewer may see the account it belongs to.
 * Null for an account without a picture and for one the viewer may not see, which look the same.
 */
export async function findVisibleAvatar(viewer: AccountViewer, name: string): Promise<{ data: Uint8Array; mimeType: ImageType } | null> {
    const legacy = LEGACY_NAME.exec(name);
    for (const userId of legacy ? [name, legacy[1]] : [name]) {
        if (!(await maySeePicture(viewer, userId))) continue;
        const row = await prisma.avatar.findUnique({ where: { userId }, select: { data: true, mimeType: true } });
        if (row) return { data: new Uint8Array(row.data), mimeType: row.mimeType as ImageType };
    }
    return null;
}
