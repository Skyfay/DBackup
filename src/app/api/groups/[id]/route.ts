import { NextResponse, type NextRequest } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getGroupDetails } from "@/services/user/group-details";

const log = logger.child({ route: "groups/[id]" });

/** The history of one group: when it was made, how its permissions changed and who moved in. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.GROUPS.READ);
        // In All tenants the group may be of any tenant, so it needs the right to see the accounts of the platform, like the panel of a user there.
        if (ctx.allTenants) checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.ACCOUNTS_READ);
        const details = await getGroupDetails(id);
        if (!details) return NextResponse.json({ success: false, error: "The group no longer exists" }, { status: 404 });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading a group failed", { groupId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The group could not be loaded" }, { status: 500 });
    }
}
