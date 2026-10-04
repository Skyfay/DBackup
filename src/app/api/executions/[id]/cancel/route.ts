import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { abortExecution, isExecutionRunning } from "@/lib/execution/abort";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

interface CancelledRun {
    id: string;
    jobId: string | null;
    job: { name: string } | null;
}

/**
 * Notes a cancel that went through as a change of the job the run belongs to. A run without a job,
 * like a restore, has no job to note it on.
 */
async function logCancel(ctx: AuthContext, run: CancelledRun) {
    if (!run.jobId) return;
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.JOB,
        { action: "cancel", ...(run.job ? { name: run.job.name } : {}), executionId: run.id },
        run.jobId
    );
}

/**
 * POST /api/executions/[id]/cancel
 *
 * Cancel a running or pending execution.
 */
export async function POST(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);

    const { id } = await props.params;

    const execution = await prisma.execution.findUnique({
        where: { id },
        select: { id: true, status: true, jobId: true, job: { select: { name: true } } },
    });

    if (!execution) {
        return NextResponse.json({ success: false, error: "Execution not found" }, { status: 404 });
    }

    // Cancel pending executions directly (not yet running)
    if (execution.status === "Pending") {
        await prisma.execution.update({
            where: { id },
            data: {
                status: "Cancelled",
                endedAt: new Date(),
                logs: JSON.stringify([{
                    timestamp: new Date().toISOString(),
                    level: "warn",
                    type: "general",
                    message: "Execution was cancelled by user before it started",
                    stage: "Cancelled",
                }]),
                metadata: JSON.stringify({ progress: 0, stage: "Cancelled" }),
            },
        });
        await logCancel(ctx, execution);
        return NextResponse.json({ success: true, message: "Pending execution cancelled" });
    }

    // Cancel running executions via abort signal (or DB fallback if not tracked in this process)
    if (execution.status === "Running") {
        // Try in-memory abort first (works when execution runs in this process)
        if (isExecutionRunning(id)) {
            const aborted = abortExecution(id);
            if (aborted) {
                await logCancel(ctx, execution);
                return NextResponse.json({ success: true, message: "Cancellation signal sent" });
            }
        }

        // Fallback: execution not tracked in memory (e.g. HMR reload, different process).
        // Force cancel via direct DB update.
        const current = await prisma.execution.findUnique({
            where: { id },
            select: { logs: true },
        });

        let logs: Array<Record<string, unknown>> = [];
        try {
            logs = current?.logs ? JSON.parse(current.logs as string) : [];
        } catch { /* ignore parse errors */ }

        logs.push({
            timestamp: new Date().toISOString(),
            level: "warn",
            type: "general",
            message: "Execution was force-cancelled by user (process not tracked)",
            stage: "Cancelled",
        });

        await prisma.execution.update({
            where: { id },
            data: {
                status: "Cancelled",
                endedAt: new Date(),
                logs: JSON.stringify(logs),
                metadata: JSON.stringify({ progress: 0, stage: "Cancelled" }),
            },
        });

        await logCancel(ctx, execution);
        return NextResponse.json({ success: true, message: "Execution force-cancelled" });
    }

    return NextResponse.json(
        { success: false, error: `Cannot cancel execution with status: ${execution.status}` },
        { status: 400 }
    );
}
