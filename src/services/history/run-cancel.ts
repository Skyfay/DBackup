import prisma from "@/lib/prisma";
import { abortExecution, isExecutionRunning } from "@/lib/execution/abort";
import { ConflictError, NotFoundError } from "@/lib/logging/errors";

/** The run a cancel went through for, with the job the audit entry names. */
export interface CancelledRun {
    id: string;
    jobId: string | null;
    job: { name: string } | null;
}

export interface CancelResult {
    run: CancelledRun;
    /** What the caller is told, which says how the run was stopped. */
    message: string;
}

const CANCELLED_METADATA = JSON.stringify({ progress: 0, stage: "Cancelled" });

function cancelLine(message: string) {
    return { timestamp: new Date().toISOString(), level: "warn", type: "general", message, stage: "Cancelled" };
}

/**
 * Cancels a pending or running run. A pending run is marked cancelled before it starts. A running
 * one gets the abort signal when it runs in this process, and is marked cancelled in the database
 * when it does not, like after a reload or in another process.
 *
 * Throws `NotFoundError` when there is no such run and `ConflictError` when it is neither pending
 * nor running.
 */
export async function cancelRun(id: string): Promise<CancelResult> {
    const execution = await prisma.execution.findUnique({
        where: { id },
        select: { id: true, status: true, jobId: true, job: { select: { name: true } } },
    });
    if (!execution) throw new NotFoundError("Execution", id);

    if (execution.status === "Pending") {
        await prisma.execution.update({
            where: { id },
            data: {
                status: "Cancelled",
                endedAt: new Date(),
                logs: JSON.stringify([cancelLine("Execution was cancelled by user before it started")]),
                metadata: CANCELLED_METADATA,
            },
        });
        return { run: execution, message: "Pending execution cancelled" };
    }

    if (execution.status === "Running") {
        if (isExecutionRunning(id) && abortExecution(id)) {
            return { run: execution, message: "Cancellation signal sent" };
        }

        // Not tracked in this process, so nothing would ever stop it. The run is ended in the
        // database instead, keeping the lines it wrote.
        const current = await prisma.execution.findUnique({ where: { id }, select: { logs: true } });
        let logs: Array<Record<string, unknown>> = [];
        try {
            logs = current?.logs ? JSON.parse(current.logs as string) : [];
        } catch { /* ignore parse errors */ }
        logs.push(cancelLine("Execution was force-cancelled by user (process not tracked)"));

        await prisma.execution.update({
            where: { id },
            data: {
                status: "Cancelled",
                endedAt: new Date(),
                logs: JSON.stringify(logs),
                metadata: CANCELLED_METADATA,
            },
        });
        return { run: execution, message: "Execution force-cancelled" };
    }

    throw new ConflictError(`Cannot cancel execution with status: ${execution.status}`);
}
