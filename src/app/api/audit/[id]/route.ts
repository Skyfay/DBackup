import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getAuditEntryDetails } from "@/services/audit/audit-details";

const log = logger.child({ route: "audit/[id]" });

/** The panel of one entry: what changed, the sign-in it came from and the entries around it. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.AUDIT.READ);
        const details = await getAuditEntryDetails(id);
        if (!details) return NextResponse.json({ success: false, error: "The entry is no longer in the audit log" }, { status: 404 });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading an audit entry failed", { auditId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The entry could not be loaded" }, { status: 500 });
    }
}
