import { NextRequest, NextResponse } from "next/server";
import { systemTaskService, SYSTEM_TASKS, DEFAULT_TASK_CONFIG } from "@/services/system-task-service";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { scheduler } from "@/lib/scheduler";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

export async function GET(_req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await checkPermission(PERMISSIONS.SETTINGS.READ); // assuming generic settings permission

    const tasks = [];
    for (const [_key, taskId] of Object.entries(SYSTEM_TASKS)) {
        const schedule = await systemTaskService.getTaskConfig(taskId);
        const runOnStartup = await systemTaskService.getTaskRunOnStartup(taskId);
        const config = DEFAULT_TASK_CONFIG[taskId];

        if (!config) continue;

        tasks.push({
            id: taskId,
            schedule,
            runOnStartup,
            label: config.label,
            description: config.description
        });
    }

    return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const body = await req.json();
    const { taskId, schedule, runOnStartup } = body;

    if (!taskId) {
         return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    if (schedule !== undefined) {
        await systemTaskService.setTaskConfig(taskId, schedule);
    }

    if (runOnStartup !== undefined) {
        await systemTaskService.setTaskRunOnStartup(taskId, runOnStartup);
    }

    // Refresh scheduler
    await scheduler.refresh();

    if (session.user) {
        await auditService.log(
            session.user.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.SYSTEM,
            { task: taskId, schedule, runOnStartup },
            taskId
        );
    }

    return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
    // Run Task immediately manual trigger
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const body = await req.json();
    const { taskId } = body;

    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

    // Run async
    systemTaskService.runTask(taskId);

    if (session.user) {
        await auditService.log(
            session.user.id,
            AUDIT_ACTIONS.EXECUTE,
            AUDIT_RESOURCES.SYSTEM,
            { task: taskId },
            taskId
        );
    }

    return NextResponse.json({ success: true, message: "Task started" });
}
