import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { deleteBackupsBulk, setBackupsLocked } from "@/services/storage/bulk-delete";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { destinationAuditName } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, PermissionError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/[id]/files/bulk" });

const BulkFilesSchema = z.object({
    action: z.enum(["delete", "lock", "unlock"]),
    paths: z.array(z.string().min(1)).min(1).max(BULK_REQUEST_LIMIT),
});

const LABELS = {
    delete: { verb: "delete", verbPast: "deleted", noun: "backup" },
    lock: { verb: "lock", verbPast: "locked", noun: "backup" },
    unlock: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
} as const;

/**
 * Applies one action to several backups on a destination.
 *
 * Lock lives here rather than staying a Server Action so that bulk lock is reachable with
 * an API key on the same terms as bulk delete. The single-file `lockBackup` action is
 * unchanged.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DELETE);

        const parsed = BulkFilesSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        }
        const { action, paths } = parsed.data;

        const result = action === "delete"
            ? await deleteBackupsBulk(params.id, paths)
            : await setBackupsLocked(params.id, paths, action === "lock");

        const destination = await destinationAuditName(params.id);
        await auditService.logFor(
            ctx,
            action === "delete" ? AUDIT_ACTIONS.DELETE : AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.BACKUP,
            {
                bulk: true,
                action,
                requested: paths.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                ...(destination ? { destination } : {}),
            },
            params.id
        );

        if (action === "delete" && result.succeeded.length > 0) {
            // Once for the batch, and non-blocking as on the single-file route.
            import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
                refreshStorageStatsCache().catch(() => {});
            });
        }

        return NextResponse.json({
            success: true,
            data: result,
            message: summarizeBulkResult(result, LABELS[action]),
        });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        log.error("Bulk storage action failed", { adapterConfigId: params.id }, wrapError(error));
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) || "Bulk action failed" },
            { status: 500 }
        );
    }
}
