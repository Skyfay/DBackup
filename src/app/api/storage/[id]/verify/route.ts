import { NextRequest, NextResponse } from "next/server";
import { verificationService } from "@/services/storage/verification-service";
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

const log = logger.child({ route: "storage/verify" });

/**
 * Checks one backup against its checksum and keeps the result in its `.meta.json`.
 *
 * Whoever may see the backups checks them, as before tenants: the check hands nothing out, and the
 * one thing it writes is its own result. It changes a backup of one tenant, so All tenants checks
 * none, and the audit log keeps who checked which backup.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const tenantId = tenantOf(ctx);

        const body = await req.json();
        const { file } = body;

        if (!file || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        // A backup in the tenant's view of the destination, the way the download reads it, before
        // anything is checked or noted.
        await findDestinationPath(params.id, file, tenantId);

        const result = await verificationService.verifyFile(params.id, file, 'manual');
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.EXECUTE,
            AUDIT_RESOURCES.BACKUP,
            { action: "verify", ...(await backupAuditDetails(params.id, file)), status: result.status },
            params.id
        );

        return NextResponse.json({ success: true, data: result });
    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        if (error instanceof NotFoundError) return NextResponse.json({ error: "Destination not found" }, { status: 404 });
        log.error("Verify route error", { id: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
