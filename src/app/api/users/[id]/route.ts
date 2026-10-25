import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { maySeeAccount } from "@/services/user/account-visibility";
import { getUserDetails } from "@/services/user/user-details";
import { logViewOf } from "@/services/audit/log-reach";

const log = logger.child({ route: "users/[id]" });

/**
 * The panel of one user: sign-in methods, open sessions, API keys and their latest activity. Only
 * of an account the caller may see, see `maySeeAccount`.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const requestHeaders = await headers();
    const ctx = await getAuthContext(requestHeaders);
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.USERS.READ);
        // An account the caller may not see reads like one that does not exist.
        if (!(await maySeeAccount(ctx, id))) return NextResponse.json({ success: false, error: "The user no longer exists" }, { status: 404 });
        // The session of the viewer is marked in the list, so the panel never offers to end it.
        const session = ctx.authMethod === "session" ? await auth.api.getSession({ headers: requestHeaders }).catch(() => null) : null;
        // The activity follows the view of the log the caller has, like the Audit log tab.
        const details = await getUserDetails(id, session?.session.id ?? null, Date.now(), await logViewOf(ctx));
        if (!details) return NextResponse.json({ success: false, error: "The user no longer exists" }, { status: 404 });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading a user failed", { userId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The user could not be loaded" }, { status: 500 });
    }
}
