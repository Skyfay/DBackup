import { isPlatformOnly, PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { permissionInfo } from "@/lib/auth/permission-areas";

/**
 * What a platform group may hold for whoever makes, changes or gives it, as plain rules for the
 * actions and the editor alike. Nobody hands out a platform group that may do more than they may:
 * its rights on the platform are among their own, and its rights in the tenants are among those
 * of their own platform group, in tenants their own platform group reaches. A platform admin may
 * do everything.
 */

/** A platform group as the caps compare it: its rights and where they count. */
export interface PlatformGroupShape {
    platformPermissions: readonly string[];
    tenantPermissions: readonly string[];
    /** Every tenant, the ones made later too. */
    allTenants: boolean;
    /** The tenants of its scope while it does not cover every tenant. */
    tenantIds: readonly string[];
}

/** Who makes, changes or gives a platform group. */
export interface PlatformGroupActor {
    isPlatformAdmin: boolean;
    /** What the actor may do now, which holds their rights on the platform wherever they work. */
    permissions: readonly string[];
    /** Their own platform group, none for someone who holds none. */
    group: PlatformGroupShape | null;
}

/** Whether a permission is a right on the platform a platform group may hold: the settings of the instance or the platform's own. */
export const isPlatformRight = (permission: string) => PLATFORM_PERMISSIONS.has(permission) || isPlatformOnly(permission);

/** The words the editor and the actions use when a right is beyond the actor. */
export const BEYOND_YOU_PLATFORM = "You may not do this yourself, so you cannot give it to a platform group.";
export const BEYOND_YOUR_SCOPE = "Your own platform group does not reach this tenant, so you cannot give it.";
export const BEYOND_ALL_TENANTS = "Your own platform group does not reach every tenant, so you cannot give all of them.";

/** Why the editor locks a right on the platform for the actor, null when they may give it. */
export function lockedPlatformRight(actor: PlatformGroupActor, permission: string): string | null {
    if (actor.isPlatformAdmin) return null;
    return actor.permissions.includes(permission) ? null : BEYOND_YOU_PLATFORM;
}

/** Why the editor locks a right in the tenants for the actor, null when they may give it: what their own platform group gives there. */
export function lockedTenantRight(actor: PlatformGroupActor, permission: string): string | null {
    if (actor.isPlatformAdmin) return null;
    return actor.group?.tenantPermissions.includes(permission) ? null : BEYOND_YOU_PLATFORM;
}

/** Why the editor locks a tenant of the scope for the actor, null when they may pick it. */
export function lockedTenant(actor: PlatformGroupActor, tenantId: string): string | null {
    if (actor.isPlatformAdmin || actor.group?.allTenants) return null;
    return actor.group?.tenantIds.includes(tenantId) ? null : BEYOND_YOUR_SCOPE;
}

/** Why the editor locks All tenants for the actor, null when they may pick it. */
export function lockedAllTenants(actor: PlatformGroupActor): string | null {
    if (actor.isPlatformAdmin || actor.group?.allTenants) return null;
    return BEYOND_ALL_TENANTS;
}

const names = (permissions: readonly string[]) => {
    const shown = permissions.slice(0, 3).map((permission) => permissionInfo(permission)?.label ?? permission);
    return `${shown.join(", ")}${permissions.length > 3 ? ` and ${permissions.length - 3} more` : ""}`;
};

/**
 * Why the actor may not make, change or give a platform group like this one, null when they may.
 * Its rights on the platform must be among their own, its rights in the tenants among those of
 * their own platform group, and its scope within the scope of their own platform group.
 */
export function platformGroupRefusal(actor: PlatformGroupActor, group: PlatformGroupShape): string | null {
    if (actor.isPlatformAdmin) return null;
    const platform = group.platformPermissions.filter((permission) => lockedPlatformRight(actor, permission) !== null);
    if (platform.length > 0) return `A platform group can only get what you may do yourself. You may not: ${names(platform)}.`;
    const tenant = group.tenantPermissions.filter((permission) => lockedTenantRight(actor, permission) !== null);
    if (tenant.length > 0) return `A platform group can only get in the tenants what your own platform group gives there. Yours does not give: ${names(tenant)}.`;
    if (group.allTenants) return lockedAllTenants(actor);
    return group.tenantIds.some((tenantId) => lockedTenant(actor, tenantId) !== null) ? "A platform group can only reach the tenants your own platform group reaches." : null;
}
