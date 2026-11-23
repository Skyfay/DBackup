import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { jobService } from "@/services/jobs/job-service";
import { jobAuditName } from "@/services/jobs/job-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { refusedUnless, serviceRefusal } from "@/lib/server/permission-refusal";

const log = logger.child({ route: "jobs/[id]/clone" });

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE));
    if (refused) return refused;

    const params = await props.params;
    let body: { name?: string } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }

    try {
        const clonedJob = await jobService.cloneJob(params.id, body.name?.trim() || undefined);
        const originalName = await jobAuditName(params.id);
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.JOB,
            { name: clonedJob.name, ...(originalName ? { clonedFromName: originalName } : {}) },
            clonedJob.id
        );
        return NextResponse.json(clonedJob, { status: 201 });
    } catch (error: unknown) {
        // A job that is gone, a link it holds to another tenant or a name in use is the caller's to fix.
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Clone job error", { jobId: params.id }, wrapError(error));
        return NextResponse.json({ error: "The job could not be copied. The log of DBackup has the details." }, { status: 500 });
    }
}
