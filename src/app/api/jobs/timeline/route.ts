import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getJobTimeline } from "@/services/jobs/job-timeline-service";

const log = logger.child({ route: "jobs/timeline" });

/**
 * GET /api/jobs/timeline
 * The runs of every job a week back and a week ahead, for the Timeline and Upcoming views of the
 * Jobs page: what ran, what runs and waits now, and what the schedules plan with their usual
 * length and where the queue makes one wait.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
        return NextResponse.json({ success: true, data: await getJobTimeline() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the job timeline", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the timeline" }, { status: 500 });
    }
}
