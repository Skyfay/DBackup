import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getUsersModel } from "@/services/user/users-model";

const log = logger.child({ route: "users" });

/** The Users tab: every user with how they sign in, their group and their sessions. Never a password hash or a token. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.USERS.READ);
        return NextResponse.json({ success: true, data: await getUsersModel(ctx.userId, ctx.isSuperAdmin) });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the users failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The users could not be loaded" }, { status: 500 });
    }
}
