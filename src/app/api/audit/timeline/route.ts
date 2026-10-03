import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { parseAuditFilter, timeZoneOr } from "@/services/audit/audit-params";
import { getAuditTimeline, validRange } from "@/services/audit/audit-timeline";

const log = logger.child({ route: "audit/timeline" });

/**
 * Who wrote how many entries on each day from `start` to `end` (`yyyy-MM-dd`, at most 93 days), the
 * days cut in the time zone `tz`, under the other filters of the list.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.AUDIT.READ);
    } catch (error) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        throw error;
    }

    const params = req.nextUrl.searchParams;
    const start = params.get("start") ?? "";
    const end = params.get("end") ?? "";
    const filter = parseAuditFilter(params);
    if (!filter || !validRange(start, end)) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    try {
        const data = await getAuditTimeline(start, end, timeZoneOr(params.get("tz") ?? undefined), filter);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        log.error("Loading the audit timeline failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The timeline could not be loaded." }, { status: 500 });
    }
}
