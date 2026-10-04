import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { checkPermissionWithContext, getAuthContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The guard of every route of a configuration restore. A restore writes users, groups and
 * sign-in providers, so it could make anyone a SuperAdmin: it needs settings:write and a signed-in
 * SuperAdmin, never an API key, checked before the body of a request is read.
 */
export async function requireConfigRestorer(): Promise<AuthContext | NextResponse> {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);
    if (!ctx.isSuperAdmin || ctx.authMethod !== "session") {
        return NextResponse.json({ success: false, error: "Only a SuperAdmin restores a configuration backup." }, { status: 403 });
    }
    return ctx;
}
