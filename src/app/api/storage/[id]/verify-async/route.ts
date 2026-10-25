import { NextRequest, NextResponse } from "next/server";
import { startCopyVerification } from "@/services/storage/copy-verification";
import { userService } from "@/services/user/user-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { backupAuditDetails } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, wrapError, getErrorMessage } from "@/lib/logging/errors";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { findDestinationPath } from "@/services/sharing/destination-access";

const log = logger.child({ route: "storage/verify-async" });

/**
 * Starts a check of one backup against its checksum as a run in History. The rules of
 * `storage/[id]/verify` hold: whoever may see the backups, in one tenant, with an audit entry.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const tenantId = tenantOf(ctx);

        const body = await req.json();
        const { file } = body;

        if (!file || typeof file !== "string" || file.includes("..") || file.startsWith("/")) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        // A backup in the tenant's view of the destination, the way the download reads it.
        await findDestinationPath(params.id, file, tenantId);

        const startedBy = (await userService.nameOf(ctx.userId)) ?? "Manual";
        // One copy is a check of copies with one entry, so it runs, logs and notifies the same way.
        const { executionId } = await startCopyVerification([{ destinationId: params.id, file }], startedBy);
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.EXECUTE,
            AUDIT_RESOURCES.BACKUP,
            { action: "verify", ...(await backupAuditDetails(params.id, file)), executionId },
            params.id
        );

        return NextResponse.json({ success: true, executionId });
    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        if (error instanceof NotFoundError) return NextResponse.json({ error: "Destination not found" }, { status: 404 });
        log.error("Verify-async route error", { id: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
