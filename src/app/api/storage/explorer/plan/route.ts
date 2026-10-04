import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerPlanService } from "@/services/storage/explorer-plan-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/plan" });

registerAdapters();

/**
 * GET /api/storage/explorer/plan
 * What the schedule of every job plans for the next days, with the full backups and what the
 * retention removes after each run, and the days whose runs did not start. For the timeline of
 * the Backups tab.
 */
export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const data = await storageExplorerPlanService.getPlan();
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the plan", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the plan" }, { status: 500 });
    }
}
