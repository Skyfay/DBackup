import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkAnyPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { CANCEL_PERMISSIONS, mayCancelRun } from "@/lib/auth/run-cancel-rule";
import { refusedUnless } from "@/lib/server/permission-refusal";
import { ConflictError, NotFoundError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { cancelAuditEntries, cancelRun, runTypeOf, type CancelResult } from "@/services/history/run-cancel";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

/**
 * Notes a cancel that went through: a run of a job on the job, any other run, like a restore or a
 * customer's run of a backup of a shared database, on what it is of. The viewer's own log keeps it,
 * and a customer's cancel that stopped the run of the server's tenant is noted in that tenant's log too.
 */
async function logCancel(ctx: AuthContext, result: CancelResult) {
    for (const entry of cancelAuditEntries(result)) {
        const resource = entry.resource === "JOB" ? AUDIT_RESOURCES.JOB : AUDIT_RESOURCES.BACKUP;
        if (entry.tenantId) {
            // The log of another tenant, without the API key of the customer, which that tenant does not know.
            await auditService.log(ctx.userId, AUDIT_ACTIONS.UPDATE, resource, entry.details, entry.resourceId, { tenantId: entry.tenantId });
        } else {
            await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, resource, entry.details, entry.resourceId);
        }
    }
}

/**
 * POST /api/executions/[id]/cancel
 *
 * Cancel a running or pending execution. Whoever may start a run of its type cancels it, see
 * `mayCancelRun`: a backup with `jobs:execute`, a restore with `storage:restore`.
 */
export async function POST(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    // Nobody without any right to cancel learns whether a run exists.
    const refused = refusedUnless(() => checkAnyPermissionWithContext(ctx, CANCEL_PERMISSIONS));
    if (refused) return refused;

    const { id } = await props.params;

    let result: CancelResult;
    try {
        // The right that starts a run of its type cancels it, so a restore needs `storage:restore`.
        if (!mayCancelRun(ctx, await runTypeOf(id))) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
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

    await logCancel(ctx, result);
    return NextResponse.json({ success: true, message: result.message });
}
