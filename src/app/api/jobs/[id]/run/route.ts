import { NextRequest, NextResponse } from "next/server";
import { backupService } from "@/services/backup-service";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    const id = params.id;

    // We run this asynchronously to not block the UI if it takes long
    // But for feedback, we might want to await it if it's short.
    // Recommended: Trigger async, return "Started".
    // Ideally use a queue (BullMQ), but for this MVP, just float the promise.

    // However, Vercel/NextJS serverless functions might kill the process if response is sent.
    // Since this is likely a self-hosted tool (Local Backup Manager), we can try awaiting it
    // or assume the runtime keeps running.
    // Let's await it for now to provide immediate feedback on success/fail for the "Test Run".

    try {
        await checkPermission(PERMISSIONS.JOBS.EXECUTE);

        const result = await backupService.executeJob(id);

        // Audit log
        if (result.success) {
            await auditService.log(
                session.user.id,
                AUDIT_ACTIONS.EXECUTE,
                AUDIT_RESOURCES.JOB,
                {
                    executionId: result.executionId,
                    trigger: "manual",
                },
                id
            );
        }

        return NextResponse.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
