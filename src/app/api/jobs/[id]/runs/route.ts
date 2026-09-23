import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getJobRunHistory } from "@/services/jobs/job-list-service";

const log = logger.child({ route: "jobs/runs" });

/**
 * GET /api/jobs/[id]/runs
 * The latest runs of one job with their length and size, its success rate over the last 30 days
 * and its last successful run, for the details of the job.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
        return NextResponse.json({ success: true, data: await getJobRunHistory(id) });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the runs of a job", { jobId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the runs" }, { status: 500 });
    }
}
