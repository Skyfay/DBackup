import { ALL_TENANTS_REFUSAL, hasPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { managesTenant, routeActor, TENANT_GONE, type TenantAdminActor } from "@/services/tenant/tenant-admin";

/**
 * Who may read or change the members and the invitations of one tenant through
 * `/api/tenants/{id}/members` and `/api/tenants/{id}/invitations`, two ways:
 *
 * - **The platform**: `platform-tenants:read` or `:write` and a tenant the caller looks after, any
 *   tenant for a platform admin, the tenants of the platform group otherwise. A key carries these
 *   rights only when it was made in the home tenant, and reaches what its owner reaches.
 * - **The tenant itself**: `users:read` or `:write` in the tenant of the request, a session working
 *   there or a key made there. Never another tenant, never All tenants.
 *
 * The platform comes first, it may do more, like adding an account of another tenant.
 */
export type TenantRouteAccess =
    | { kind: "platform"; actor: TenantAdminActor }
    | { kind: "tenant" }
    | { kind: "refused"; status: 403 | 404; error: string };

export async function tenantRouteAccess(ctx: AuthContext, tenantId: string, write: boolean): Promise<TenantRouteAccess> {
    const platformRight = write ? PERMISSIONS.PLATFORM.TENANTS_WRITE : PERMISSIONS.PLATFORM.TENANTS_READ;
    const tenantRight = write ? PERMISSIONS.USERS.WRITE : PERMISSIONS.USERS.READ;
    const onPlatform = hasPermissionWithContext(ctx, platformRight);
    if (onPlatform) {
        const actor = await routeActor(ctx);
        if (await managesTenant(actor, tenantId)) return { kind: "platform", actor };
    }
    if (ctx.tenantId === tenantId && hasPermissionWithContext(ctx, tenantRight)) return { kind: "tenant" };
    // A tenant beyond the platform group reads as gone, like on Platform > Tenants.
    if (onPlatform) return { kind: "refused", status: 404, error: TENANT_GONE };
    if (ctx.allTenants) return { kind: "refused", status: 403, error: ALL_TENANTS_REFUSAL };
    return { kind: "refused", status: 403, error: `Permission denied: ${platformRight} or ${tenantRight} in this tenant required` };
}
