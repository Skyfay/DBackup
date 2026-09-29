import { NextRequest, NextResponse } from "next/server";
import { systemTaskService, SYSTEM_TASKS, DEFAULT_TASK_CONFIG } from "@/services/system/system-task-service";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { headers } from "next/headers";
import { scheduler } from "@/lib/server/scheduler";
import { auditService } from "@/services/audit-service";
import { taskChanges, taskName, taskSnapshot } from "@/services/system/system-task-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { Cron } from "croner";
import prisma from "@/lib/prisma";

const log = logger.child({ route: "system-tasks" });

export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ); // assuming generic settings permission

    const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
    const timezone = tzSetting?.value || "UTC";

    const tasks = [];
    for (const [_key, taskId] of Object.entries(SYSTEM_TASKS)) {
        const schedule = await systemTaskService.getTaskConfig(taskId);
        const runOnStartup = await systemTaskService.getTaskRunOnStartup(taskId);
        const enabled = await systemTaskService.getTaskEnabled(taskId);
        const lastRunAt = await systemTaskService.getTaskLastRunAt(taskId);
        const config = DEFAULT_TASK_CONFIG[taskId];

        if (!config) continue;

        let nextRunAt: string | null = null;
        if (enabled && schedule) {
            try {
                const job = new Cron(schedule, { timezone });
                const next = job.nextRun();
                nextRunAt = next ? next.toISOString() : null;
            } catch {
                // Invalid cron expression - leave nextRunAt null
            }
        }

        tasks.push({
            id: taskId,
            schedule,
            runOnStartup,
            enabled,
            label: config.label,
            description: config.description,
            lastRunAt,
            nextRunAt,
            timezone,
        });
    }

    return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const body = await req.json();
    const { taskId, schedule, runOnStartup, enabled } = body;

    if (!taskId) {
         return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const before = await taskSnapshot(taskId);

    if (schedule !== undefined) {
        await systemTaskService.setTaskConfig(taskId, schedule);
    }

    if (runOnStartup !== undefined) {
        await systemTaskService.setTaskRunOnStartup(taskId, runOnStartup);
    }

    if (enabled !== undefined) {
        await systemTaskService.setTaskEnabled(taskId, enabled);
    }

    // Refresh scheduler
    scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after system task update", {}, wrapError(e)));

    const after = await taskSnapshot(taskId);
    // Switching a task on or off alone reads as that, anything else as a change with its values.
    const switchedOnly = enabled !== undefined && schedule === undefined && runOnStartup === undefined;
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.SYSTEM,
        {
            task: after.name,
            name: after.name,
            ...(typeof enabled === "boolean" ? { enabled } : {}),
            ...(switchedOnly ? {} : { changes: taskChanges(before, after) }),
        },
        taskId
    );

    return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
    // Run Task immediately manual trigger
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const body = await req.json();
    const { taskId } = body;

    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });

    const executionId = await systemTaskService.runTask(taskId, "Manual", user?.name ?? "Manual");

    const name = taskName(taskId);
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.EXECUTE,
        AUDIT_RESOURCES.SYSTEM,
        { task: name, name },
        taskId
    );

    return NextResponse.json({ success: true, ...(executionId ? { executionId } : {}) });
}
