import { PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { permissionInfo } from "@/lib/auth/permission-areas";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { AccountActor } from "./account-access";

/**
 * What a group may hold, as plain rules for the actions and the editor alike. A group belongs to
 * one tenant, and its admins make and change it there. Nobody makes a group that may do more than
 * they may themselves, and the settings of the instance only count in the home tenant, so a group
 * of any other tenant never holds them.
 */

/** Whether a permission can be given to a group of the tenant at all: the settings of the instance only in the home tenant. */
export function grantableIn(permission: string, tenantId: string | null): boolean {
    return tenantId === HOME_TENANT_ID || !PLATFORM_PERMISSIONS.has(permission);
}

/** The permissions a group of the tenant keeps of what was asked for, without the settings of the instance outside the home tenant. */
export function capToTenant(permissions: readonly string[], tenantId: string): string[] {
    return permissions.filter((permission) => grantableIn(permission, tenantId));
}

/** The words the editor and the actions use when a permission is beyond the actor. */
export const BEYOND_YOU = "You may not do this yourself, so you cannot give it to a group.";

/**
 * Why the actor may not give a group these permissions in their tenant, null when they may. A
 * platform admin gives any, everyone else only what they hold there themselves.
 */
export function groupCapRefusal(actor: AccountActor, permissions: readonly string[]): string | null {
    if (actor.isPlatformAdmin) return null;
    if (!actor.tenantId) return "Open a tenant to change its groups.";
    const held = new Set(actor.permissions);
    const beyond = permissions.filter((permission) => !held.has(permission));
    if (beyond.length === 0) return null;
    const names = beyond.slice(0, 3).map((permission) => permissionInfo(permission)?.label ?? permission);
    const more = beyond.length > 3 ? ` and ${beyond.length - 3} more` : "";
    return `A group can only get what you may do yourself. You may not: ${names.join(", ")}${more}.`;
}

/**
 * Why the editor locks a permission for the viewer, null when it may be ticked: what the viewer
 * does not hold, unless they are a platform admin.
 */
export function lockedFor(viewer: { platformAdmin: boolean; permissions: readonly string[] | null }, permission: string): string | null {
    if (viewer.platformAdmin || viewer.permissions === null) return null;
    return viewer.permissions.includes(permission) ? null : BEYOND_YOU;
}
