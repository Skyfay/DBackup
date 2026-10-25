import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getAllUsersModel } from "@/services/user/users-all-model";
import { getUsersModel } from "@/services/user/users-model";

const log = logger.child({ route: "users" });

/**
 * The Users tab: every user with how they sign in, their group and their sessions. Never a password
 * hash or a token. In All tenants every account of the instance with its group in each tenant,
 * for whoever may see the accounts of the platform like `/api/platform/users`.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.USERS.READ);
        // Every account of the instance is what Platform > Users & Groups shows, so it needs the same right there.
        if (ctx.allTenants) checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.ACCOUNTS_READ);
        const model = ctx.allTenants ? await getAllUsersModel(ctx.userId, ctx.isPlatformAdmin) : await getUsersModel(ctx.userId, ctx.isPlatformAdmin, tenantOf(ctx));
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the users failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The users could not be loaded" }, { status: 500 });
    }
}
