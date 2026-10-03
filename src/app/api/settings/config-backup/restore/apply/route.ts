import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { requireConfigRestorer } from "@/lib/server/config-restore-guard";
import { auditService } from "@/services/audit-service";
import { applyCheckedRestore } from "@/services/config/restore-flow";

const log = logger.child({ route: "settings/config-backup/restore/apply" });

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * Restore, step two: restores a backup step one checked. A copy of the database answers with
 * `restarting` and DBackup ends a moment later, a file of an older version with what it could not
 * bring back. See `requireConfigRestorer` for who may.
 */
export async function POST(req: NextRequest) {
    const ctx = await requireConfigRestorer();
    if (ctx instanceof NextResponse) return ctx;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "No checked backup given" }, { status: 400 });

    try {
        const applied = await applyCheckedRestore(parsed.data.token, { userId: ctx.userId });
        // A copy of the database carries its own entry of this, the one here goes with the database of now.
        await auditService.logFor(ctx, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.SYSTEM, { action: "config_restore", file: applied.fileName, kind: applied.kind });
        return NextResponse.json({
            success: true,
            data: applied.kind === "database" ? { restarting: true } : { notes: applied.notes },
        });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("A configuration restore failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "The restore failed." }, { status: 500 });
    }
}
