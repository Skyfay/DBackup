import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getScheduleLoad } from "@/services/jobs/schedule-load-service";

const log = logger.child({ route: "jobs/schedules" });

/**
 * GET /api/jobs/schedules
 * The schedules of the enabled jobs with how long a run of each takes, the slots of the queue and
 * the scheduler's time zone, so the schedule picker can warn before runs would have to wait.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
        return NextResponse.json({ success: true, data: await getScheduleLoad() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the job schedules", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the schedules" }, { status: 500 });
    }
}
