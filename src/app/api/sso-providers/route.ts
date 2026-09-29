import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getSsoProvidersModel } from "@/services/sso/sso-providers-model";

const log = logger.child({ route: "sso-providers" });

/**
 * The Sign-in tab: every provider with who is linked through it. Never the client secret. The
 * groups new people can start in come along only for someone who may change the providers.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ);
        const manager = hasPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE) ? { superAdmin: ctx.isSuperAdmin, permissions: ctx.permissions } : null;
        const model = await getSsoProvidersModel(manager);
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the sign-in providers failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The sign-in providers could not be loaded" }, { status: 500 });
    }
}
