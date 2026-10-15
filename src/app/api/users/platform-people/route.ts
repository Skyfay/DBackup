import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { platformPeopleOf } from "@/services/user/platform-people";

const log = logger.child({ route: "users/platform-people" });

/**
 * The people of the MSP who open the tenant of the request through the platform, the platform
 * admins and the members of each platform group that reaches it, for the part Through the platform
 * of the Users tab. Read only, for whoever may see the users of the tenant. Never in All tenants,
 * which is no tenant.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.USERS.READ);
        return NextResponse.json({ success: true, data: await platformPeopleOf(tenantOf(ctx)) });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the people of the platform failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The people of the platform could not be loaded" }, { status: 500 });
    }
}
