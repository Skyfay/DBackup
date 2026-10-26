import prisma from "@/lib/prisma";
import { heldGroupBeyond } from "@/lib/auth/account-access";
import { PLATFORM_ADMIN_ROLE, permissionsIn } from "@/lib/auth/owner-permissions";
import { runAsSystem } from "@/lib/tenant/context";

/**
 * The accounts among these that hold, in one of their tenants, a group that may do more than the
 * viewer may there, which the viewer does not change, see `accountRefusal`. The lists of users lock
 * them with the reason. None for a platform admin, and the own account is left out, its owner
 * changes it under Profile.
 */
export async function groupsBeyondViewer(viewerId: string, userIds: readonly string[]): Promise<Set<string>> {
    const others = userIds.filter((id) => id !== viewerId);
    if (others.length === 0) return new Set();
    // An account and its memberships belong to no tenant, and the groups are read wherever they belong.
    const [viewer, memberships] = await runAsSystem(() => Promise.all([
        prisma.user.findUnique({
            where: { id: viewerId },
            select: {
                platformRole: true,
                memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
                platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
            },
        }),
        prisma.tenantMembership.findMany({
            where: { userId: { in: others } },
            select: { userId: true, tenantId: true, group: { select: { permissions: true, fullAccess: true } } },
        }),
    ]));
    if (!viewer || viewer.platformRole === PLATFORM_ADMIN_ROLE) return new Set();

    // What the viewer may do in each tenant, as their session would there.
    const tenantIds = [...new Set(memberships.map((membership) => membership.tenantId))];
    const permissionsByTenant = Object.fromEntries(tenantIds.map((tenantId) => [tenantId, permissionsIn(viewer.memberships, tenantId, viewer.platformGroup)]));
    const actor = { isPlatformAdmin: false, tenantId: null, permissions: [], permissionsByTenant };
    return new Set(memberships.filter((membership) => heldGroupBeyond(actor, [membership])).map((membership) => membership.userId));
}
