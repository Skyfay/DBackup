import prisma from "@/lib/prisma";
import { abortExecution, isExecutionRunning } from "@/lib/execution/abort";
import { endFollowers, leaderOf } from "@/lib/execution/follower-runs";
import { runAsSystem } from "@/lib/tenant/context";
import { ConflictError, NotFoundError } from "@/lib/logging/errors";
import { backupOf } from "@/services/tenant/shared-backup-runs";
import { parseMetadata } from "./run-row";

/** The run a cancel went through for, with the job or the subject the audit entry names. */
export interface CancelledRun {
    id: string;
    jobId: string | null;
    job: { name: string } | null;
    tenantId: string;
    /**
     * What a run without a job is of, like the database a customer backed up or restored, or the
     * backup a restore read. Null for a run of a job, and for one that says nothing of it.
     */
    subject: string | null;
}

export interface CancelResult {
    run: CancelledRun;
    /**
     * The run the cancelled one follows, which stopped with it, like the run of the job of a shared
     * server that a customer's backup follows. Null for a run that follows none.
     */
    leader: CancelledRun | null;
    /** What the caller is told, which says how the run was stopped. */
    message: string;
}

const RUN_SELECT = { id: true, status: true, jobId: true, metadata: true, path: true, tenantId: true, job: { select: { name: true } } } as const;

interface RunRecord {
    id: string;
    status: string;
    jobId: string | null;
    metadata: string | null;
    path: string | null;
    tenantId: string;
    job: { name: string } | null;
}

const CANCELLED_METADATA = JSON.stringify({ progress: 0, stage: "Cancelled" });

function cancelLine(message: string) {
    return { timestamp: new Date().toISOString(), level: "warn", type: "general", message, stage: "Cancelled" };
}

/** What a run without a job is of: the database of a shared one, else the backup it read, else where it restored to. */
export function subjectOf(run: { metadata: string | null; path: string | null }): string | null {
    const metadata = parseMetadata(run.metadata) as Record<string, unknown>;
    const backup = backupOf(metadata);
    if (backup) return backup.database;
    const restored = metadata.restoreOf as { database?: unknown } | undefined;
    if (typeof restored?.database === "string" && restored.database) return restored.database;
    const file = run.path?.split("/").filter(Boolean).pop();
    if (file) return file;
    const target = metadata.target as { name?: unknown } | undefined;
    return typeof target?.name === "string" && target.name ? target.name : null;
}

function cancelledRun(run: RunRecord): CancelledRun {
    return { id: run.id, jobId: run.jobId, job: run.job, tenantId: run.tenantId, subject: run.jobId ? null : subjectOf(run) };
}

/**
 * Cancels a pending or running run. A pending run is marked cancelled before it starts. A running
 * one gets the abort signal when it runs in this process, and is marked cancelled in the database
 * when it does not, like after a reload or in another process.
 *
 * A run that follows another one, like the customer's run of a backup they started of a shared
 * database, cancels the run it follows, which may belong to another tenant, and ends with it.
 *
 * Throws `NotFoundError` when there is no such run and `ConflictError` when it is neither pending
 * nor running.
 */
export async function cancelRun(id: string): Promise<CancelResult> {
    const execution = await prisma.execution.findUnique({ where: { id }, select: RUN_SELECT });
    if (!execution) throw new NotFoundError("Execution", id);

    const leader = leaderOf(execution.metadata);
    if (leader && (execution.status === "Pending" || execution.status === "Running")) {
        // Found in the viewer's tenant above, so the run it follows is read for every tenant.
        const result = await runAsSystem(() => cancelLeader(leader));
        return { run: cancelledRun(execution), leader: result.leader, message: result.message };
    }
    return cancelOwn(execution);
}

/** Cancels the run a follower follows. Its end ends the follower, or this does when it is gone. */
async function cancelLeader(leaderId: string): Promise<{ leader: CancelledRun | null; message: string }> {
    const leader = await prisma.execution.findUnique({ where: { id: leaderId }, select: RUN_SELECT });
    if (!leader || (leader.status !== "Pending" && leader.status !== "Running")) {
        await endFollowers(leaderId, "Cancelled");
        return { leader: null, message: "Execution cancelled" };
    }
    const result = await cancelOwn(leader);
    return { leader: result.run, message: result.message };
}

async function cancelOwn(execution: RunRecord): Promise<CancelResult> {
    const id = execution.id;
    const run = cancelledRun(execution);

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
        await endFollowers(id, "Cancelled");
        return { run, leader: null, message: "Pending execution cancelled" };
    }

    if (execution.status === "Running") {
        if (isExecutionRunning(id) && abortExecution(id)) {
            return { run, leader: null, message: "Cancellation signal sent" };
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
        await endFollowers(id, "Cancelled");
        return { run, leader: null, message: "Execution force-cancelled" };
    }

    throw new ConflictError(`Cannot cancel execution with status: ${execution.status}`);
}

/** One entry of the audit log a cancel writes. */
export interface CancelAuditEntry {
    resource: "JOB" | "BACKUP";
    resourceId?: string;
    details: Record<string, unknown>;
    /** The tenant whose log keeps it, the viewer's own when left out. */
    tenantId?: string;
}

/**
 * What the audit log keeps of a cancel. The viewer's log notes the run they cancelled: a run of a job
 * on the job, any other run, like a restore or a customer's backup of a shared database, on what it
 * is of. A customer's run that stopped the run of the job of the server's tenant is noted in that
 * tenant's log too, on the job, like the start of it.
 */
export function cancelAuditEntries(result: Pick<CancelResult, "run" | "leader">): CancelAuditEntry[] {
    const { run, leader } = result;
    const own: CancelAuditEntry = run.jobId
        ? { resource: "JOB", resourceId: run.jobId, details: { action: "cancel", ...(run.job ? { name: run.job.name } : {}), executionId: run.id } }
        : { resource: "BACKUP", details: { action: "cancel", ...(run.subject ? { name: run.subject } : {}), executionId: run.id } };
    if (!leader?.jobId || leader.tenantId === run.tenantId) return [own];
    return [own, {
        resource: "JOB",
        resourceId: leader.jobId,
        details: { action: "cancel", ...(leader.job ? { name: leader.job.name } : {}), ...(run.subject ? { database: run.subject } : {}), executionId: leader.id },
        tenantId: leader.tenantId,
    }];
}
