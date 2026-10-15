import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkAnyPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getSsoProvidersModel } from "@/services/sso/sso-providers-model";

const log = logger.child({ route: "sso-providers" });

/**
 * The SSO tab: every provider with who is linked through it, for whoever may see the sign-in
 * providers of the platform, a right of a platform group that an API key never holds. Never the
 * client secret. They see the providers of every tenant with the groups new people can start in.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkAnyPermissionWithContext(ctx, [PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.SETTINGS.READ]);
        const model = await getSsoProvidersModel(true);
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the sign-in providers failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The sign-in providers could not be loaded" }, { status: 500 });
    }
}
