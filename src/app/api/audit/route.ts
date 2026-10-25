import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cached } from "@/services/dashboard/cache";
import { getAuditFacets, getAuditStats, getAuditWhoOptions, listAudit } from "@/services/audit/audit-list-service";
import { parseAuditQuery } from "@/services/audit/audit-params";
import { logViewOf } from "@/services/audit/log-reach";
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
        // In the log of the home tenant someone of a platform group of some tenants sees the entries
        // of those tenants alone, so the caches are kept by what the reader sees.
        const view = await logViewOf(ctx);
        const [list, facets, who, stats] = await Promise.all([
            listAudit(query, new Date(), view),
            // All tenants reads the log of every tenant and filters it by tenant.
            getAuditFacets(query, new Date(), ctx.allTenants, view),
            cached(`audit-who:${view.key}`, CACHE_MS, () => getAuditWhoOptions(view)),
            cached(`audit-stats:${view.key}`, CACHE_MS, () => getAuditStats(new Date(), view)),
        ]);
        const data: AuditPage = { rows: list.rows, total: list.total, facets, who, stats };
        return NextResponse.json({ success: true, data });
    } catch (error) {
        log.error("Loading the audit log failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The audit log could not be loaded." }, { status: 500 });
    }
}
