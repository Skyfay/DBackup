import { NextRequest, NextResponse } from "next/server";
import { systemTaskService, SYSTEM_TASKS, DEFAULT_TASK_CONFIG } from "@/services/system-task-service";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { scheduler } from "@/lib/scheduler";

export async function GET(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await checkPermission(PERMISSIONS.SETTINGS.READ); // assuming generic settings permission

    const tasks = [];
    for (const [id, key] of Object.entries(SYSTEM_TASKS)) {
        const schedule = await systemTaskService.getTaskConfig(key);
        const config = DEFAULT_TASK_CONFIG[key as keyof typeof DEFAULT_TASK_CONFIG];
        tasks.push({
            id: key,
            schedule,
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
    const { taskId, schedule } = body;

    if (!taskId || !schedule) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await systemTaskService.setTaskConfig(taskId, schedule);

    // Refresh scheduler
    await scheduler.refresh();

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

    return NextResponse.json({ success: true, message: "Task started" });
}
