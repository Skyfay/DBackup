import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { getRunDetail } from "@/services/history/run-detail-service";
import { getRunRow } from "@/services/history/run-list-service";

const log = logger.child({ route: "history/runs/[id]" });

/**
 * One run for its page: the steps with their lines and usual times, what to look at, its copies,
 * the notifications it sent, the runs of the same job around it and who waits for it. The page
 * asks again every few seconds while the run is live. `row=1` returns only its row, without the log.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);
    } catch {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { id } = await props.params;
    try {
        const run = req.nextUrl.searchParams.get("row") === "1" ? await getRunRow(id) : await getRunDetail(id);
        if (!run) return NextResponse.json({ success: false, error: "This run could not be found. Data retention may have removed it." }, { status: 404 });
        return NextResponse.json({ success: true, data: run });
    } catch (error) {
        log.error("Failed to load a run", { id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The run could not be loaded." }, { status: 500 });
    }
}
