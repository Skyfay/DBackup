import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, PermissionError, ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { findDestinationPath } from "@/services/sharing/destination-access";
import { readCopyVerification, startCopyVerification } from "@/services/storage/copy-verification";
import { userService } from "@/services/user/user-service";
import { auditService } from "@/services/audit-service";
import { backupAuditDetails } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

const log = logger.child({ route: "storage/verify-copies" });

const StartSchema = z.object({
    copies: z.array(z.object({
        destinationId: z.string().min(1),
        file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    })).min(1).max(50),
});

function failure(error: unknown, what: string): NextResponse {
    if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Destination not found" }, { status: 404 });
    log.error(what, {}, wrapError(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
}

/**
 * Checks copies of a backup against their checksums, one after the other in one run in History.
 * Answers with the run at once, which `GET` then follows. Whoever may see the backups checks them,
 * in one tenant, since each check keeps its result in the `.meta.json` of the copy, and the audit
 * log gets an entry per copy.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const tenantId = tenantOf(ctx);

        const parsed = StartSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }

        // Every copy in the tenant's view of its destination, the way the download reads it, before
        // the run starts and anything is noted.
        for (const copy of parsed.data.copies) await findDestinationPath(copy.destinationId, copy.file, tenantId);

        const startedBy = (await userService.nameOf(ctx.userId)) ?? "Manual";
        const { executionId } = await startCopyVerification(parsed.data.copies, startedBy);
        for (const copy of parsed.data.copies) {
            await auditService.logFor(
                ctx,
                AUDIT_ACTIONS.EXECUTE,
                AUDIT_RESOURCES.BACKUP,
                { action: "verify", ...(await backupAuditDetails(copy.destinationId, copy.file)), executionId },
                copy.destinationId
            );
        }
        return NextResponse.json({ success: true, data: { executionId } });
    } catch (error: unknown) {
        return failure(error, "Starting a copy verification failed");
    }
}

/** Where a check of copies stands: the run and every copy with its state and download progress. */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const executionId = new URL(req.url).searchParams.get("executionId");
        if (!executionId) return NextResponse.json({ success: false, error: "Missing executionId" }, { status: 400 });

        const verification = await readCopyVerification(executionId);
        if (!verification) return NextResponse.json({ success: false, error: "No check of copies with this id" }, { status: 404 });
        return NextResponse.json({ success: true, data: verification });
    } catch (error: unknown) {
        return failure(error, "Reading a copy verification failed");
    }
}
