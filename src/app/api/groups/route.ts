import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getGroupsModel, getPlatformGroupsModel } from "@/services/user/groups-model";

const log = logger.child({ route: "groups" });

/**
 * The Groups tab: every group with its permissions and members. The people outside the groups only
 * for a viewer who may see the users. In All tenants the groups of every tenant, read only.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.GROUPS.READ);
        const withPeople = hasPermissionWithContext(ctx, PERMISSIONS.USERS.READ);
        const model = ctx.allTenants
            ? await getPlatformGroupsModel(ctx.userId)
            : await getGroupsModel(ctx.userId, ctx.isPlatformAdmin, withPeople, tenantOf(ctx));
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the groups failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The groups could not be loaded" }, { status: 500 });
    }
}
