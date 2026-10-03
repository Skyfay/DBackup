import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { auditCsv } from "@/services/audit/audit-export";
import { parseAuditFilter } from "@/services/audit/audit-params";

const log = logger.child({ route: "audit/export" });

/**
 * The entries the filters of the list keep, as a CSV file. Exporting the log is written to the log
 * itself, with the filters it used.
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
    const filter = parseAuditFilter(params);
    if (!filter) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });

    try {
        const { csv, count } = await auditCsv(filter);
        await auditService.logFor(ctx, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.SYSTEM, { action: "audit_export", count, filter: params.toString() });
        const day = new Date().toISOString().slice(0, 10);
        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="dbackup-audit-log-${day}.csv"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        log.error("Exporting the audit log failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The audit log could not be exported." }, { status: 500 });
    }
}
