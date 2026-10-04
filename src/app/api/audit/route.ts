import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cached } from "@/services/dashboard/cache";
import { getAuditFacets, getAuditStats, getAuditWhoOptions, listAudit } from "@/services/audit/audit-list-service";
import { parseAuditQuery } from "@/services/audit/audit-params";
import type { AuditPage } from "@/services/audit/audit-types";

const log = logger.child({ route: "audit" });
const CACHE_MS = 30 * 1000;

/**
 * One page of the audit log, newest first, with the counts beside every filter, the options of
 * the Who filter and the numbers of the last 30 days. See `parseAuditFilter` for the query.
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

    const query = parseAuditQuery(req.nextUrl.searchParams);
    if (!query) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    try {
        const [list, facets, who, stats] = await Promise.all([
            listAudit(query),
            getAuditFacets(query),
            cached("audit-who", CACHE_MS, getAuditWhoOptions),
            cached("audit-stats", CACHE_MS, () => getAuditStats()),
        ]);
        const data: AuditPage = { rows: list.rows, total: list.total, facets, who, stats };
        return NextResponse.json({ success: true, data });
    } catch (error) {
        log.error("Loading the audit log failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The audit log could not be loaded." }, { status: 500 });
    }
}
