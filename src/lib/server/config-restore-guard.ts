import { checkPermissionWithContext, getAuthContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requestHeaders } from "@/lib/server/request-headers";
import { refusedUnless } from "@/lib/server/permission-refusal";

/**
 * The guard of every route of a configuration restore. A restore writes the whole database, every
 * tenant, user and sign-in provider, so it could make anyone a platform admin: it needs
 * settings:write and a signed-in platform admin, never an API key, checked before the body of a
 * request is read.
 */
export async function requireConfigRestorer(): Promise<AuthContext | Response> {
    const ctx = await getAuthContext(await requestHeaders());
    if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE));
    if (refused) return refused;
    if (!ctx.isPlatformAdmin || ctx.authMethod !== "session") {
        return Response.json({ success: false, error: "Only a platform admin restores a configuration backup." }, { status: 403 });
    }
    return ctx;
}
