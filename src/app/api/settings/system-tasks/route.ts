import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";
import { auditService } from "@/services/audit-service";
import { isSystemTaskId } from "@/services/system/system-task-definitions";
import { getSystemTaskRows, saveSystemTask, startSystemTask } from "@/services/system/system-task-settings";
import { getGeneralSettings } from "@/services/system/system-settings-service";
import { taskChanges, taskName, taskSnapshot } from "@/services/system/system-task-audit";

const log = logger.child({ route: "system-tasks" });

const taskId = z.string().refine(isSystemTaskId, { message: "Unknown system task" });

const updateSchema = z.object({
    taskId,
    schedule: z.string().trim().min(1).optional(),
    runOnStartup: z.boolean().optional(),
    enabled: z.boolean().optional(),
});

export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ);

    const { timezone } = await getGeneralSettings();
    const rows = await getSystemTaskRows(timezone);
    // The fields of earlier versions stay, the label and the start of the last run included.
    return NextResponse.json(rows.map((row) => ({
        ...row,
        label: row.name,
        lastRunAt: row.lastRun?.at ?? null,
        timezone,
    })));
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !isSystemTaskId(parsed.data.taskId)) {
        return NextResponse.json({ error: parsed.success ? "Unknown system task" : parsed.error.issues[0].message }, { status: 400 });
    }
    const { taskId: task, ...input } = parsed.data;
    if (!isSystemTaskId(task)) return NextResponse.json({ error: "Unknown system task" }, { status: 400 });

    const before = await taskSnapshot(task);
    try {
        await saveSystemTask(task, input);
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
        log.error("Failed to save a system task", { taskId: task }, wrapError(error));
        return NextResponse.json({ error: "Failed to save the task" }, { status: 500 });
    }

    const after = await taskSnapshot(task);
    // Switching a task on or off alone reads as that, anything else as a change with its values.
    const switchedOnly = input.enabled !== undefined && input.schedule === undefined && input.runOnStartup === undefined;
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.SYSTEM,
        {
            task: after.name,
            name: after.name,
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(switchedOnly ? {} : { changes: taskChanges(before, after) }),
        },
        task
    );

    return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
    // Run Task immediately manual trigger
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const parsed = z.object({ taskId }).safeParse(await req.json().catch(() => null));
    if (!parsed.success || !isSystemTaskId(parsed.data.taskId)) {
        return NextResponse.json({ error: "Unknown system task" }, { status: 400 });
    }
    const task = parsed.data.taskId;

    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    const started = await startSystemTask(task, user?.name ?? "Manual");
    if (!started.started) return NextResponse.json({ error: started.reason }, { status: 409 });

    const name = taskName(task);
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.EXECUTE,
        AUDIT_RESOURCES.SYSTEM,
        { task: name, name },
        task
    );

    return NextResponse.json({ success: true, ...(started.executionId ? { executionId: started.executionId } : {}) });
}
