import prisma from "@/lib/prisma";
import { NotFoundError } from "@/lib/logging/errors";

/** A run as scripts that poll it through the API read it. */
export interface RunStatus {
    id: string;
    jobId: string | null;
    jobName: string | null;
    type: string;
    status: string;
    progress: number | null;
    stage: string | null;
    startedAt: string;
    endedAt: string | null;
    /** Milliseconds, up to now while the run goes on. */
    duration: number;
    size: number | null;
    path: string | null;
    /** The last error line of a failed run. */
    error: string | null;
    /** Set when data retention cleared the log. `logs` is then an empty array. */
    logsPurgedAt: string | null;
    /** Only when asked for. */
    logs?: unknown[];
}

/**
 * Where a run stands, with its progress and stage and, for a failed run, its last error. The whole
 * log only when asked for, because a script polling a run rarely needs it.
 *
 * Throws `NotFoundError` when there is no such run.
 */
export async function getRunStatus(id: string, options: { includeLogs: boolean }): Promise<RunStatus> {
    const execution = await prisma.execution.findUnique({
        where: { id },
        include: {
            job: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    if (!execution) throw new NotFoundError("Execution", id);

    let progress: number | null = null;
    let stage: string | null = null;
    let error: string | null = null;

    if (execution.metadata) {
        try {
            const meta = JSON.parse(execution.metadata);
            progress = meta.progress ?? null;
            stage = meta.stage ?? null;
        } catch {
            // Skip if metadata can't be parsed
        }
    }

    if (execution.status === "Failed") {
        try {
            const logs = JSON.parse(execution.logs);
            const errorLog = logs.findLast?.((l: { level: string }) => l.level === "error");
            if (errorLog) {
                error = errorLog.message || null;
            }
        } catch {
            // Skip if logs can't be parsed
        }
    }

    const status: RunStatus = {
        id: execution.id,
        jobId: execution.jobId,
        jobName: execution.job?.name ?? null,
        type: execution.type,
        status: execution.status,
        progress,
        stage,
        startedAt: execution.startedAt.toISOString(),
        endedAt: execution.endedAt?.toISOString() ?? null,
        duration: execution.endedAt
            ? execution.endedAt.getTime() - execution.startedAt.getTime()
            : Date.now() - execution.startedAt.getTime(),
        size: execution.size ? Number(execution.size) : null,
        path: execution.path ?? null,
        error,
        logsPurgedAt: execution.logsPurgedAt?.toISOString() ?? null,
    };

    if (!options.includeLogs) return status;
    try {
        return { ...status, logs: JSON.parse(execution.logs) };
    } catch {
        return { ...status, logs: [] };
    }
}
