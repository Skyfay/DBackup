import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getAllUsersModel } from "@/services/user/users-all-model";

const log = logger.child({ route: "platform/users" });

/**
 * The Users tab of Users & Groups under Platform: every account of the instance once, with its
 * tenants, its group in each and its platform group, from whichever tenant the viewer opens it.
 * For whoever may see the accounts of the platform, never an API key. Never a password hash or a token.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (ctx.authMethod !== "session" || !hasPermissionWithContext(ctx, PERMISSIONS.PLATFORM.ACCOUNTS_READ)) {
        return NextResponse.json({ success: false, error: "Only someone who may see the accounts of the platform sees every account." }, { status: 403 });
    }

    try {
        return NextResponse.json({ success: true, data: await getAllUsersModel(ctx.userId, ctx.isPlatformAdmin) });
    } catch (error: unknown) {
        log.error("Loading every account failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The accounts could not be loaded" }, { status: 500 });
    }
}
