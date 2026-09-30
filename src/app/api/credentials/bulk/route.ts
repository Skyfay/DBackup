import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { PERMANENT_DELETE_REFUSED } from "@/lib/core/delete-mode";
import * as credentialService from "@/services/auth/credential-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { PermissionError, wrapError, getErrorMessage } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "credentials/bulk" });

const BulkCredentialsSchema = z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().min(1)).min(1).max(BULK_REQUEST_LIMIT),
    /** Skips Recently deleted. */
    permanently: z.boolean().optional(),
});

/**
 * Deletes several credential profiles.
 *
 * A profile still attached to an adapter is refused per entry with its reference count,
 * rather than aborting the selection.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.DELETE);

        const parsed = BulkCredentialsSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        }

        const permanently = parsed.data.permanently ?? false;
        if (permanently && !hasPermissionWithContext(ctx, TRASH_ADMIN_PERMISSION)) {
            return NextResponse.json({ success: false, error: PERMANENT_DELETE_REFUSED }, { status: 403 });
        }
        const result = await credentialService.deleteCredentialProfiles(parsed.data.ids, { permanently, by: ctx.userId });

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.CREDENTIAL,
            {
                bulk: true,
                requested: parsed.data.ids.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                ...(permanently ? { permanently: true } : {}),
            }
        );

        return NextResponse.json({
            success: true,
            data: result,
            message: summarizeBulkResult(result, {
                verb: "delete",
                verbPast: "deleted",
                noun: "credential profile",
            }),
        });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        log.error("Bulk credential delete failed", {}, wrapError(error));
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) || "Bulk action failed" },
            { status: 500 }
        );
    }
}
