import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { z } from "zod";
import { backupService } from "@/services/backup/backup-service";
import { TriggerInfo } from "@/lib/runner";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { apiKeyService } from "@/services/auth/api-key-service";
import { jobAuditName } from "@/services/jobs/job-audit";
import { userService } from "@/services/user/user-service";
import { serviceRefusal } from "@/lib/server/permission-refusal";

const log = logger.child({ route: "jobs/[id]/run" });

const triggerBodySchema = z.object({
    lock: z.boolean().optional(),
}).optional();

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    // A disabled, expired or blocked API key is answered by `unauthorized` with its reason.
    const ctx = await getAuthContext(await headers()).catch(() => null);

    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    const id = params.id;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);

        // Parse optional request body
        let lock: boolean | undefined;
        const contentType = req.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const rawBody = await req.json().catch(() => ({}));
            const parsed = triggerBodySchema.safeParse(rawBody);
            if (!parsed.success) {
                return NextResponse.json(
                    { success: false, error: "Invalid request body" },
                    { status: 400 }
                );
            }
            lock = parsed.data?.lock;
        }
        // Locking the backup this run makes is part of running the job, as CI keys with only
        // jobs:execute have done since the lock came. It takes no backup away from anyone.

        let triggerInfo: TriggerInfo;
        if (ctx.authMethod === "apikey" && ctx.apiKeyId) {
            const apiKey = await apiKeyService.getById(ctx.apiKeyId);
            triggerInfo = { type: "Api", label: apiKey.name };
        } else {
            triggerInfo = { type: "Manual", label: (await userService.nameOf(ctx.userId)) ?? "Unknown" };
        }

        const result = await backupService.executeJob(id, triggerInfo, { lock });

        if (result.success) {
            const name = await jobAuditName(id);
            await auditService.logFor(
                ctx,
                AUDIT_ACTIONS.EXECUTE,
                AUDIT_RESOURCES.JOB,
                {
                    ...(name ? { name } : {}),
                    executionId: result.executionId,
                    trigger: ctx.authMethod === "apikey" ? "api" : "manual",
                    lock: lock ?? false,
                    // The key has a column of its own now, the details keep it for readers that look here.
                    ...(ctx.apiKeyId ? { apiKeyId: ctx.apiKeyId } : {}),
                },
                id
            );
        }

        return NextResponse.json(result);
    } catch (error: unknown) {
        // A job of another tenant is answered like one that does not exist.
        if (error instanceof NotFoundError) {
            return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
        }
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Starting a job failed", { jobId: id }, wrapError(error));
        return NextResponse.json(
            { success: false, error: "The job could not be started. The log of DBackup has the details." },
            { status: 500 }
        );
    }
}
