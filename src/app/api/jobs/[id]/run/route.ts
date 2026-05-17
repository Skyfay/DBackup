import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backupService } from "@/services/backup/backup-service";
import { TriggerInfo } from "@/lib/runner";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ApiKeyError } from "@/lib/logging/errors";
import { apiKeyService } from "@/services/auth/api-key-service";
import prisma from "@/lib/prisma";

const triggerBodySchema = z.object({
    lock: z.boolean().optional(),
}).optional();

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    let ctx: AuthContext | null;
    try {
        ctx = await getAuthContext(await headers());
    } catch (error) {
        if (error instanceof ApiKeyError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 401 }
            );
        }
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

        let triggerInfo: TriggerInfo;
        if (ctx.authMethod === "apikey" && ctx.apiKeyId) {
            const apiKey = await apiKeyService.getById(ctx.apiKeyId);
            triggerInfo = { type: "Api", label: apiKey.name };
        } else {
            const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
            triggerInfo = { type: "Manual", label: user?.name ?? "Unknown" };
        }

        const result = await backupService.executeJob(id, triggerInfo, { lock });

        // Audit log
        if (result.success) {
            await auditService.log(
                ctx.userId,
                AUDIT_ACTIONS.EXECUTE,
                AUDIT_RESOURCES.JOB,
                {
                    executionId: result.executionId,
                    trigger: ctx.authMethod === "apikey" ? "api" : "manual",
                    lock: lock ?? false,
                    ...(ctx.apiKeyId ? { apiKeyId: ctx.apiKeyId } : {}),
                },
                id
            );
        }

        return NextResponse.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const status = error instanceof Error && error.message.includes("Permission") ? 403 : 500;
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}
