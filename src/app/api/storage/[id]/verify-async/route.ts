import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { startCopyVerification } from "@/services/storage/copy-verification";
import { userService } from "@/services/user/user-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { backupAuditDetails } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { findDestinationPath } from "@/services/sharing/destination-access";
import { backupPathRefusal, configBackupRefusal } from "@/lib/server/config-backup-guard";

const log = logger.child({ route: "storage/verify-async" });

/**
 * Starts a check of one backup against its checksum as a run in History. The rules of
 * `storage/[id]/verify` hold: whoever may see the backups, in one tenant, with an audit entry.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const tenantId = tenantOf(ctx);

        const body = await req.json();
        const { file } = body;

        // A path that leaves the destination answers 400, see `assertBackupPath`.
        const badPath = backupPathRefusal(file);
        if (badPath) return badPath;

        // A backup in the tenant's view of the destination, the way the download reads it.
        await findDestinationPath(params.id, file, tenantId);
        // A configuration backup is read only by a platform admin with a session, its check too,
        // which downloads it and notes the result in its sidecar, like `verify-copies`.
        const configBackup = await configBackupRefusal(ctx, params.id, file);
        if (configBackup) return configBackup;

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
        return NextResponse.json({ error: "The check of the backup could not be started. The log of DBackup has the details." }, { status: 500 });
    }
}
