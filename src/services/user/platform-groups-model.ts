import prisma from "@/lib/prisma";
import { EVERY_PERMISSION, PLATFORM_PERMISSIONS, isPlatformOnly } from "@/lib/auth/owner-permissions";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { tenantService } from "@/services/tenant/tenant-service";
import { tenantSummaries } from "@/services/tenant/tenant-summaries";
import type { GroupActor } from "./groups-types";
import { platformGroupService } from "./platform-group-service";
import { PLATFORM_ADMIN_GROUP_ID, type PlatformGroupRow, type PlatformGroupsModel } from "./platform-groups-types";

/** The newest entries of the audit log read at most, so a log with years of changes stays quick. */
const AUDIT_LIMIT = 500;

/** Who looks at the platform groups, as the route resolved them. */
export interface PlatformGroupsViewerInput {
    id: string;
    platformAdmin: boolean;
    permissions: readonly string[];
}

/** When each platform group was made and last changed, and by whom, as far as the audit log of the home tenant knows. */
async function madeAndChanged(): Promise<{ made: Map<string, GroupActor>; changed: Map<string, GroupActor> }> {
    const rows = await runAsSystem(() => prisma.auditLog.findMany({
        where: { tenantId: HOME_TENANT_ID, resource: AUDIT_RESOURCES.PLATFORM_GROUP, action: { in: [AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] } },
        orderBy: { createdAt: "desc" },
        take: AUDIT_LIMIT,
        select: { resourceId: true, action: true, createdAt: true, actorName: true, user: { select: { name: true } } },
    }));
    const made = new Map<string, GroupActor>();
    const changed = new Map<string, GroupActor>();
    for (const row of rows) {
        if (!row.resourceId) continue;
        const actor = { at: row.createdAt.toISOString(), by: row.user?.name ?? row.actorName ?? null };
        // Newest first, so the last create wins and the first update stays.
        if (row.action === AUDIT_ACTIONS.CREATE) made.set(row.resourceId, actor);
        else if (!changed.has(row.resourceId)) changed.set(row.resourceId, actor);
    }
    return { made, changed };
}

/** Every right a platform admin holds, on the platform and in every tenant. */
const ADMIN_PLATFORM = EVERY_PERMISSION.filter((permission) => PLATFORM_PERMISSIONS.has(permission) || isPlatformOnly(permission));
const ADMIN_TENANT = AVAILABLE_PERMISSIONS.map((permission) => permission.id).filter((permission) => !PLATFORM_PERMISSIONS.has(permission));

/**
 * The platform groups of Users & Groups under Platform: Platform admin first, built in with the
 * platform admins as its members, then the others by name, each with its rights, its scope, its
 * members and when it was made and changed. With the tenants a scope can pick, all of them for a
 * platform admin and the ones they may open for anyone else, and what the viewer may give. Read
 * as the system, since the viewer may open it from inside any tenant.
 */
export async function getPlatformGroupListModel(viewer: PlatformGroupsViewerInput): Promise<PlatformGroupsModel> {
    return runAsSystem(async () => {
        const [groups, admins, tenants, accounts, audit, own] = await Promise.all([
            platformGroupService.list(),
            platformGroupService.platformAdmins(),
            // A platform admin sees every tenant, anyone else the tenants they may open themselves.
            viewer.platformAdmin
                ? prisma.tenant.findMany({ select: { id: true, name: true } })
                : tenantService.switchable(viewer.id, false).then((list) => list.map((tenant) => ({ id: tenant.id, name: tenant.name }))),
            prisma.user.count(),
            madeAndChanged(),
            viewer.platformAdmin ? null : platformGroupService.shapeOf(viewer.id),
        ]);
        const summaries = new Map((await tenantSummaries(tenants.map((tenant) => tenant.id))).map((summary) => [summary.id, summary]));
        const member = (user: { id: string; name: string; email: string; image: string | null }) => ({ ...user, isYou: user.id === viewer.id });

        const builtIn: PlatformGroupRow = {
            id: PLATFORM_ADMIN_GROUP_ID,
            name: "Platform admin",
            builtIn: true,
            platformPermissions: ADMIN_PLATFORM,
            tenantPermissions: ADMIN_TENANT,
            allTenants: true,
            tenantIds: [],
            members: admins.map(member),
            createdAt: new Date(0).toISOString(),
            made: null,
            changed: null,
        };
        const rows: PlatformGroupRow[] = groups.map((group) => ({
            id: group.id,
            name: group.name,
            builtIn: false,
            platformPermissions: [...group.platformPermissions],
            tenantPermissions: [...group.tenantPermissions],
            allTenants: group.allTenants,
            tenantIds: [...group.tenantIds],
            members: group.members.map(member),
            createdAt: group.createdAt.toISOString(),
            made: audit.made.get(group.id) ?? null,
            changed: audit.changed.get(group.id) ?? null,
        }));

        return {
            groups: [builtIn, ...rows],
            tenants: tenants
                .map((tenant) => ({
                    id: tenant.id,
                    name: tenant.name,
                    isHome: tenant.id === HOME_TENANT_ID,
                    jobs: summaries.get(tenant.id)?.jobs ?? 0,
                    databases: summaries.get(tenant.id)?.databases ?? 0,
                }))
                .sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name)),
            accounts,
            viewer: {
                platformAdmin: viewer.platformAdmin,
                permissions: [...viewer.permissions],
                group: own?.shape ?? null,
                groupId: own?.id ?? null,
            },
        };
    });
}
