import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkAnyPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getSsoProvidersModel } from "@/services/sso/sso-providers-model";
import { accountsSeenReach } from "@/services/user/account-visibility";
import { platformGroupService } from "@/services/user/platform-group-service";

const log = logger.child({ route: "sso-providers" });

/**
 * The SSO tab: the providers with who is linked through each, never the client secret, for a
 * signed-in person who may see the sign-in providers of the platform or the settings of the
 * instance. Whoever reads the settings through their group of the home tenant, without a platform
 * group, sees every provider of every tenant, as on an install of one tenant before platform
 * groups. Someone of a platform group sees those of the platform and of the tenants it reaches,
 * whichever of the two rights they hold, every one for a platform admin and a platform group of
 * all tenants. The people beside them are only those whose accounts the viewer may see
 * (`accountsSeenReach`), none but their own without the right to see the accounts of the platform,
 * and only a platform admin, who alone changes the providers, gets the groups new people can start
 * in. An API key gets `settings:read` from the group of its owner in the home tenant, see
 * `ownerPermissionsIn`, so the route answers sessions only.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (ctx.authMethod !== "session") {
        return NextResponse.json({ success: false, error: "The sign-in providers are shown to a signed-in person only." }, { status: 403 });
    }

    try {
        checkAnyPermissionWithContext(ctx, [PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.SETTINGS.READ]);
        const reach = !ctx.platformGroup && hasPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ) ? "all" : await platformGroupService.reachOf(ctx.userId);
        const model = await getSsoProvidersModel(ctx.isPlatformAdmin, { reach, peopleReach: await accountsSeenReach(ctx), viewerId: ctx.userId });
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the sign-in providers failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The sign-in providers could not be loaded" }, { status: 500 });
    }
}
