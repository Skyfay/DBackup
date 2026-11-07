import { tenantOf, type AuthContext } from "@/lib/auth/access-control";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { PermissionError } from "@/lib/logging/errors";

/**
 * A read of a database server by the config of a form, instead of by a saved source, runs a config
 * the caller wrote, with a host, a file and a login of their choosing. So it is for someone who may
 * change connections of that kind, inside one tenant, like the form that sends it. Someone who may
 * only see the connections reads the saved ones by their id, and All tenants, which belongs to no
 * tenant, reads none by a config.
 */
export function assertMayReadFormConfig(ctx: AuthContext, adapterId: string): void {
    tenantOf(ctx);
    if (!canEditStoredConfig(ctx, adapterId)) {
        throw new PermissionError(getManagePermissionForAdapter(adapterId) ?? "the right to change connections of this kind");
    }
}
