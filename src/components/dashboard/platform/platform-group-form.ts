import { freeGroupName } from "@/lib/auth/group-templates";
import { areaChanges, describeChange, PLATFORM_AREAS, PLATFORM_GROUP_TENANT_AREAS } from "@/lib/auth/permission-areas";
import { lockedAllTenants, lockedPlatformRight, lockedTenant, lockedTenantRight, type PlatformGroupActor } from "@/lib/auth/platform-group-caps";
import type { PlatformGroupRow, PlatformGroupsViewer } from "@/services/user/platform-groups-types";
import type { ScopeValue } from "./platform-group-scope";

/**
 * The rules of the editor of a platform group as plain functions: what it starts with, what the
 * viewer may give, and the line in its foot.
 */

/** What the editor opens on: a new group, the group itself, or a copy of one. */
export type PlatformGroupFormMode =
    | { kind: "create" }
    | { kind: "edit"; group: PlatformGroupRow }
    | { kind: "duplicate"; group: PlatformGroupRow };

export interface PlatformGroupDraft {
    name: string;
    platform: string[];
    tenant: string[];
    scope: ScopeValue;
    /** Something of the start was left out, since the viewer may not give it. */
    trimmed: boolean;
}

/** The viewer as the caps of `platform-group-caps.ts` read them. */
export function actorOf(viewer: PlatformGroupsViewer): PlatformGroupActor {
    return { isPlatformAdmin: viewer.platformAdmin, permissions: viewer.permissions, group: viewer.group };
}

/**
 * Whether the viewer may give a platform group to someone, or take it: Platform admin only a
 * platform admin, another one whoever it may do no more than, like the server checks it.
 */
export function givableBy(group: PlatformGroupRow, viewer: PlatformGroupsViewer): boolean {
    if (viewer.platformAdmin) return true;
    if (group.builtIn) return false;
    const actor = actorOf(viewer);
    return group.platformPermissions.every((permission) => lockedPlatformRight(actor, permission) === null)
        && group.tenantPermissions.every((permission) => lockedTenantRight(actor, permission) === null)
        && (group.allTenants ? lockedAllTenants(actor) === null : group.tenantIds.every((tenantId) => lockedTenant(actor, tenantId) === null));
}

/** Whether the viewer may change a platform group: never Platform admin, never their own, and only one they may give. */
export function editableBy(group: PlatformGroupRow, viewer: PlatformGroupsViewer): boolean {
    return !group.builtIn && viewer.groupId !== group.id && givableBy(group, viewer);
}

/**
 * What the editor starts with. A copy is named free of the others and leaves out what the viewer
 * may not give, and says so.
 */
export function draftOf(mode: PlatformGroupFormMode, copy: PlatformGroupRow | null, viewer: PlatformGroupsViewer, taken: string[]): PlatformGroupDraft {
    if (mode.kind === "edit") {
        const { group } = mode;
        return { name: group.name, platform: group.platformPermissions, tenant: group.tenantPermissions, scope: { allTenants: group.allTenants, tenantIds: group.tenantIds }, trimmed: false };
    }
    if (!copy) return { name: "", platform: [], tenant: [], scope: { allTenants: true, tenantIds: [] }, trimmed: false };
    const actor = actorOf(viewer);
    const platform = copy.platformPermissions.filter((permission) => lockedPlatformRight(actor, permission) === null);
    const tenant = copy.tenantPermissions.filter((permission) => lockedTenantRight(actor, permission) === null);
    const allTenants = copy.allTenants && lockedAllTenants(actor) === null;
    const tenantIds = (copy.allTenants ? viewer.group?.tenantIds ?? [] : copy.tenantIds).filter((tenantId) => lockedTenant(actor, tenantId) === null);
    const trimmed = platform.length < copy.platformPermissions.length || tenant.length < copy.tenantPermissions.length || allTenants !== copy.allTenants;
    return { name: freeGroupName(`${copy.name} copy`, taken), platform, tenant, scope: { allTenants, tenantIds }, trimmed };
}

const sameScope = (a: ScopeValue, b: ScopeValue) =>
    a.allTenants === b.allTenants && (a.allTenants || (a.tenantIds.length === b.tenantIds.length && a.tenantIds.every((tenantId) => b.tenantIds.includes(tenantId))));

/** The areas, and Where, whose level changed since the editor opened. */
export function changedAreas(before: PlatformGroupDraft, platform: ReadonlySet<string>, tenant: ReadonlySet<string>, scope: ScopeValue): string[] {
    return [
        ...areaChanges(new Set(before.platform), platform, PLATFORM_AREAS).map((change) => change.area.id),
        ...areaChanges(new Set(before.tenant), tenant, PLATFORM_GROUP_TENANT_AREAS).map((change) => change.area.id),
        ...(sameScope(before.scope, scope) ? [] : ["where"]),
    ];
}

/** "Changed: the name, Backups See to Custom, Where", or "No changes yet". */
export function changeLine(before: PlatformGroupDraft, name: string, platform: ReadonlySet<string>, tenant: ReadonlySet<string>, scope: ScopeValue): string {
    const describe = (from: string[], to: ReadonlySet<string>, areas: typeof PLATFORM_AREAS) =>
        areaChanges(new Set(from), to, areas).map((change) => describeChange(change, new Set(from), to));
    const parts = [
        ...(name.trim() !== before.name ? ["the name"] : []),
        ...describe(before.platform, platform, PLATFORM_AREAS),
        ...describe(before.tenant, tenant, PLATFORM_GROUP_TENANT_AREAS),
        ...(sameScope(before.scope, scope) ? [] : ["Where"]),
    ];
    return parts.length === 0 ? "No changes yet" : `Changed: ${parts.join(", ")}`;
}

/** "2 areas on the platform · 6 areas in 2 tenants", for a new group. */
export function createLine(platform: ReadonlySet<string>, tenant: ReadonlySet<string>, scope: ScopeValue): string {
    const count = (areas: typeof PLATFORM_AREAS, held: ReadonlySet<string>) => areas.filter((area) => area.permissions.some((permission) => held.has(permission.id))).length;
    const areas = (value: number) => `${value} ${value === 1 ? "area" : "areas"}`;
    const where = scope.allTenants ? "in every tenant" : `in ${scope.tenantIds.length} ${scope.tenantIds.length === 1 ? "tenant" : "tenants"}`;
    return `${areas(count(PLATFORM_AREAS, platform))} on the platform · ${areas(count(PLATFORM_GROUP_TENANT_AREAS, tenant))} ${where}`;
}
