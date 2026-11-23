import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { z } from "zod";
import { deleteBackupsBulk, setBackupsLocked } from "@/services/storage/bulk-delete";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { destinationAuditName } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { summarizeBulkResult, emptyBulkResult, BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { configBackupSelection } from "@/lib/server/config-backup-guard";
import { backupPathIssue } from "@/lib/server/backup-path-schema";

const log = logger.child({ route: "storage/[id]/files/bulk" });

const BulkFilesSchema = z.object({
    action: z.enum(["delete", "lock", "unlock"]),
    paths: z.array(z.string().min(1).superRefine(backupPathIssue)).min(1).max(BULK_REQUEST_LIMIT),
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
        return unauthorized();
    }

    const params = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DELETE);

        const parsed = BulkFilesSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            // A path that leaves the destination says so, see `backupPathIssue`.
            const error = parsed.error.issues.find((issue) => issue.code === "custom")?.message ?? "Invalid request body";
            return NextResponse.json({ success: false, error }, { status: 400 });
        }
        const { action, paths } = parsed.data;

        // A configuration backup is the platform's, refused on its own row, the rest goes on.
        const { allowed, refused } = await configBackupSelection(ctx, params.id, paths);
        const done = allowed.length === 0
            ? emptyBulkResult()
            : action === "delete"
                ? await deleteBackupsBulk(params.id, allowed)
                : await setBackupsLocked(params.id, allowed, action === "lock");
        const result = { succeeded: done.succeeded, failed: [...refused, ...done.failed] };

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
                refreshStorageStatsCache({ configIds: [params.id] }).catch(() => {});
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
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Bulk storage action failed", { adapterConfigId: params.id }, wrapError(error));
        return NextResponse.json(
            { success: false, error: "The bulk action failed. The log of DBackup has the details." },
            { status: 500 }
        );
    }
}
