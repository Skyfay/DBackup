import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { deleteAdapters, getAdapterTypes, updateAdapterFlags, type AdapterFlagChange } from "@/services/adapters/adapter-service";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, PermissionError } from "@/lib/logging/errors";

const log = logger.child({ route: "adapters/bulk" });

/** The settings actions, and what each one switches. */
const FLAG_ACTIONS = {
    "disable-health-alerts": { healthNotificationsDisabled: true },
    "enable-health-alerts": { healthNotificationsDisabled: false },
    "exclude-from-restore": { isRestoreExcluded: true },
    "include-in-restore": { isRestoreExcluded: false },
} satisfies Record<string, AdapterFlagChange>;

type FlagAction = keyof typeof FLAG_ACTIONS;

const BulkAdaptersSchema = z.object({
    action: z.enum(["delete", ...(Object.keys(FLAG_ACTIONS) as FlagAction[])]),
    ids: z.array(z.string().min(1)).min(1).max(BULK_REQUEST_LIMIT),
});

/**
 * Deletes several connections, or switches a setting on several at once.
 *
 * Connections are one table behind three permissions, so the check is per distinct type in
 * the selection rather than one blanket check. Deleting a mixed selection therefore
 * requires every permission it touches.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const parsed = BulkAdaptersSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        }
        const { action, ids } = parsed.data;

        // Resolving the types is a read of nothing but the type column, and it has to come
        // before the check because the check depends on it.
        const types = await getAdapterTypes(ids);
        if (types.length === 0) {
            return NextResponse.json({ success: false, error: "No matching connections" }, { status: 404 });
        }
        for (const type of types) {
            checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));
        }

        const deleting = action === "delete";
        const result = deleting ? await deleteAdapters(ids) : await updateAdapterFlags(ids, FLAG_ACTIONS[action]);

        await auditService.log(
            ctx.userId,
            deleting ? AUDIT_ACTIONS.DELETE : AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.ADAPTER,
            {
                bulk: true,
                ...(deleting ? {} : { change: action }),
                requested: ids.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
            }
        );

        const labels = deleting
            ? { verb: "delete", verbPast: "deleted", noun: "connection" }
            : { verb: "update", verbPast: "updated", noun: "connection" };
        return NextResponse.json({ success: true, data: result, message: summarizeBulkResult(result, labels) });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        log.error("Bulk adapter action failed", {}, wrapError(error));
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) || "Bulk action failed" },
            { status: 500 }
        );
    }
}
