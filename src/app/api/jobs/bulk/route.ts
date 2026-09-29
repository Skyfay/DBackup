import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { jobService } from "@/services/jobs/job-service";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, PermissionError } from "@/lib/logging/errors";

const log = logger.child({ route: "jobs/bulk" });

const BulkJobsSchema = z.object({
    action: z.enum(["delete", "enable", "disable"]),
    ids: z.array(z.string()).min(1).max(BULK_REQUEST_LIMIT),
});

const LABELS = {
    delete: { verb: "delete", verbPast: "deleted", noun: "job" },
    enable: { verb: "enable", verbPast: "enabled", noun: "job" },
    disable: { verb: "pause", verbPast: "paused", noun: "job" },
} as const;

/**
 * Applies one action to several jobs.
 *
 * POST rather than DELETE because the endpoint carries an action and a body, and a body
 * on DELETE is inconsistently supported across clients and proxies.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        // One check for the batch, since every item takes the same verb.
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

        const parsed = BulkJobsSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        }
        const { action, ids } = parsed.data;

        const result = action === "delete"
            ? await jobService.deleteJobs(ids)
            : await jobService.setJobsEnabled(ids, action === "enable");

        // One audit entry for the batch. N entries would bury the signal that actually
        // matters, that somebody removed nine jobs in a single gesture.
        await auditService.logFor(
            ctx,
            action === "delete" ? AUDIT_ACTIONS.DELETE : AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.JOB,
            {
                bulk: true,
                action,
                requested: ids.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
            }
        );

        // A failed item is not a failed request, so this stays 200 with success true and
        // the per-item outcomes in the payload.
        return NextResponse.json({
            success: true,
            data: result,
            message: summarizeBulkResult(result, LABELS[action]),
        });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        log.error("Bulk job action failed", {}, wrapError(error));
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) || "Bulk action failed" },
            { status: 500 }
        );
    }
}
