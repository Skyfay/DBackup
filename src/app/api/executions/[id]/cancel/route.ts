import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ConflictError, NotFoundError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { cancelRun, type CancelledRun, type CancelResult } from "@/services/history/run-cancel";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

/**
 * Notes a cancel that went through as a change of the job the run belongs to. A run without a job,
 * like a restore, has no job to note it on.
 */
async function logCancel(ctx: AuthContext, run: CancelledRun) {
    if (!run.jobId) return;
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.JOB,
        { action: "cancel", ...(run.job ? { name: run.job.name } : {}), executionId: run.id },
        run.jobId
    );
}

/**
 * POST /api/executions/[id]/cancel
 *
 * Cancel a running or pending execution.
 */
export async function POST(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);

    const { id } = await props.params;

    let result: CancelResult;
    try {
        result = await cancelRun(id);
    } catch (error: unknown) {
        if (error instanceof NotFoundError) {
            return NextResponse.json({ success: false, error: "Execution not found" }, { status: 404 });
        }
        // A run that has finished already. Earlier versions answer this with 400, so it stays.
        if (error instanceof ConflictError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        throw error;
    }

    await logCancel(ctx, result.run);
    return NextResponse.json({ success: true, message: result.message });
}
