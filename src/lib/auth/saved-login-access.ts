import { hasPermissionWithContext, tenantOf, type AuthContext } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

/**
 * The form-driven endpoints (connection test, database listing, snapshot check, SSH test, remote
 * file browser) take a config with a host of the caller's choosing beside the id of a saved login,
 * which they decrypt and hand to that host. So only someone who may change connections of that
 * type, or reveal the saved logins anyway, has one applied. And only inside one tenant, since All
 * tenants reads the saved logins of every tenant.
 */
export function assertMayApplySavedLogin(ctx: Pick<AuthContext, "tenantId" | "isPlatformAdmin" | "allTenants" | "permissions">, adapterId: string | undefined): void {
    tenantOf(ctx);
    const manage = adapterId ? getManagePermissionForAdapter(adapterId) : null;
    if (manage && hasPermissionWithContext(ctx, manage)) return;
    if (hasPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.REVEAL)) return;
    throw new PermissionError(manage ? `${manage} or ${PERMISSIONS.CREDENTIALS.REVEAL}` : PERMISSIONS.CREDENTIALS.REVEAL);
}

/** Whether a request names a saved login at all, by any of the ids the forms send. */
export function namesSavedLogin(...ids: unknown[]): boolean {
    return ids.some((id) => typeof id === "string" && id.length > 0);
}
