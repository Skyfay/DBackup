import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getPlatformGroupsModel } from "@/services/user/groups-model";

const log = logger.child({ route: "platform/groups" });

/**
 * The Groups tab of Users & Groups under Platform: the groups of every tenant with their tenant
 * and members, read only, from whichever tenant the viewer opens it. A group is changed
 * in its tenant. For whoever may see the accounts of the platform, never an API key.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (ctx.authMethod !== "session" || !hasPermissionWithContext(ctx, PERMISSIONS.PLATFORM.ACCOUNTS_READ)) {
        return NextResponse.json({ success: false, error: "Only someone who may see the accounts of the platform sees the groups of every tenant." }, { status: 403 });
    }

    try {
        return NextResponse.json({ success: true, data: await getPlatformGroupsModel(ctx.userId) });
    } catch (error: unknown) {
        log.error("Loading the groups of every tenant failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The groups could not be loaded" }, { status: 500 });
    }
}
