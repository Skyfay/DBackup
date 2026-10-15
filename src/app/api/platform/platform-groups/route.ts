import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getPlatformGroupListModel } from "@/services/user/platform-groups-model";

const log = logger.child({ route: "platform/platform-groups" });

/**
 * The platform groups of Users & Groups under Platform: Platform admin, built in, and the groups of
 * the people of the MSP with their rights, scope and members, and what the viewer may give. For
 * whoever may see the accounts of the platform, which an API key never may.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (ctx.authMethod !== "session" || !hasPermissionWithContext(ctx, PERMISSIONS.PLATFORM.ACCOUNTS_READ)) {
        return NextResponse.json({ success: false, error: "Only someone who may see the accounts of the platform sees its groups." }, { status: 403 });
    }

    try {
        const data = await getPlatformGroupListModel({ id: ctx.userId, platformAdmin: ctx.isPlatformAdmin, permissions: ctx.permissions });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        log.error("Loading the platform groups failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The platform groups could not be loaded" }, { status: 500 });
    }
}
