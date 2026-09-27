import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { markSteps, buildProblems, type ProblemTargets } from "./run-problems";
import { databasesOf, isRunStatus, liveOf, parseMetadata, runRow, starterOf, uploadsOf } from "./run-row";
import { buildSteps, parseLog, usualSteps } from "./run-steps";
import { RUN_SELECT, usualOf } from "./run-list-service";
import type { RunDetail, RunNeighbour, RunNotification, RunUpload } from "./run-types";

/**
 * The page of one run: its steps with their lines and usual times, what to look at, its copies,
 * the notifications it sent, the runs of the same job around it and who waits for it.
 */

const RECENT = 30;
/** Earlier runs whose steps give the usual time of each step. */
const USUAL_RUNS = 5;

const DETAIL_SELECT = {
    ...RUN_SELECT,
    logs: true,
    logsPurgedAt: true,
    backupType: true,
    job: {
        select: {
            id: true,
            name: true,
            source: { select: { id: true, name: true, adapterId: true } },
            sources: { select: { config: { select: { adapterId: true } } }, orderBy: { priority: "asc" }, take: 1 },
            destinations: { select: { configId: true, config: { select: { name: true, adapterId: true } } }, orderBy: { priority: "asc" } },
        },
    },
} satisfies Prisma.ExecutionSelect;

const NEIGHBOUR_SELECT = { id: true, startedAt: true, endedAt: true, status: true, size: true, triggerType: true, triggerLabel: true } satisfies Prisma.ExecutionSelect;

function neighbour(record: Prisma.ExecutionGetPayload<{ select: typeof NEIGHBOUR_SELECT }> | null): RunNeighbour | null {
    if (!record) return null;
    return {
        id: record.id,
        startedAt: record.startedAt.toISOString(),
        status: isRunStatus(record.status) ? record.status : "Failed",
        durationMs: record.endedAt ? record.endedAt.getTime() - record.startedAt.getTime() : null,
        size: record.size === null ? null : Number(record.size),
        starter: starterOf(record.triggerType, record.triggerLabel),
    };
}

/** The copies of a finished backup, from what its last step recorded for every destination. */
function finishedUploads(metadata: ReturnType<typeof parseMetadata>, size: number | null): RunUpload[] {
    if (!Array.isArray(metadata.destinations)) return [];
    return (metadata.destinations as { configId?: string; name?: string; adapterId?: string; status?: string; error?: string }[]).map((entry) => ({
        configId: entry.configId ?? "",
        name: entry.name ?? "A destination",
        adapterId: entry.adapterId ?? "",
        state: entry.status === "success" ? "done" : entry.status === "failed" ? "failed" : "skipped",
        bytes: entry.status === "success" ? size : null,
        total: size,
        error: entry.error ?? null,
        startedAt: null,
        endedAt: null,
    }));
}

async function usualStepsOf(jobId: string, exclude: string) {
    const runs = await prisma.execution.findMany({
        where: { jobId, status: "Success", id: { not: exclude }, logsPurgedAt: null },
        orderBy: { startedAt: "desc" },
        take: USUAL_RUNS,
        select: { logs: true },
    });
    return usualSteps(runs.map((run) => parseLog(run.logs)));
}

export async function getRunDetail(id: string, now = Date.now()): Promise<RunDetail | null> {
    const record = await prisma.execution.findUnique({ where: { id }, select: DETAIL_SELECT });
    if (!record) return null;

    const metadata = parseMetadata(record.metadata);
    const entries = parseLog(record.logs);
    const status = isRunStatus(record.status) ? record.status : "Failed";
    const live = status === "Running" || status === "Pending";
    const jobId = record.jobId;

    const [notificationRows, usual, usualMs, recent, previous, next, queue] = await Promise.all([
        prisma.notificationLog.findMany({ where: { executionId: id }, orderBy: { sentAt: "asc" }, select: { id: true, channelId: true, channelName: true, adapterId: true, status: true, error: true, title: true, sentAt: true } }),
        jobId ? usualStepsOf(jobId, id) : Promise.resolve(new Map<string, number>()),
        jobId && record.type === "Backup" ? usualOf(jobId) : Promise.resolve(null),
        jobId ? prisma.execution.findMany({ where: { jobId }, orderBy: { startedAt: "desc" }, take: RECENT, select: NEIGHBOUR_SELECT }) : Promise.resolve([]),
        jobId ? prisma.execution.findFirst({ where: { jobId, startedAt: { lt: record.startedAt } }, orderBy: { startedAt: "desc" }, select: NEIGHBOUR_SELECT }) : Promise.resolve(null),
        jobId ? prisma.execution.findFirst({ where: { jobId, startedAt: { gt: record.startedAt } }, orderBy: { startedAt: "asc" }, select: NEIGHBOUR_SELECT }) : Promise.resolve(null),
        status === "Running" ? prisma.execution.findMany({ where: { status: "Pending" }, orderBy: { startedAt: "asc" }, select: RUN_SELECT }) : Promise.resolve([]),
    ]);

    const notifications: RunNotification[] = notificationRows.map((row) => ({
        ...row,
        status: row.status === "Success" ? "Success" : "Failed",
        sentAt: row.sentAt.toISOString(),
    }));
    const destinations = record.job?.destinations.map((entry) => ({ id: entry.configId, name: entry.config.name })) ?? [];
    const targets: ProblemTargets = {
        jobName: record.job?.name ?? null,
        destinations,
        sourceName: record.job?.source?.name ?? null,
        sourceId: record.job?.source?.id ?? null,
    };
    const steps = buildSteps(entries, { type: record.type, status, currentStage: liveOf(metadata).stage, now, usual });
    const { problems, lineProblems } = buildProblems(entries, notifications, targets);

    let uploads = live ? uploadsOf(metadata) : finishedUploads(metadata, record.size === null ? null : Number(record.size));
    if (uploads.length === 0 && live && record.type === "Backup") {
        uploads = (record.job?.destinations ?? []).map((entry) => ({
            configId: entry.configId, name: entry.config.name, adapterId: entry.config.adapterId, state: "waiting", bytes: null, total: null, error: null, startedAt: null, endedAt: null,
        }));
    }

    const firstError = problems.find((problem) => problem.tone === "error");
    const row = runRow(record, usualMs, firstError ? firstError.title : null);
    return {
        ...row,
        job: record.job ? { id: record.job.id, name: record.job.name } : null,
        path: record.path,
        backupType: record.backupType,
        logsPurgedAt: record.logsPurgedAt?.toISOString() ?? null,
        databases: databasesOf(metadata),
        steps: markSteps(steps, lineProblems, problems),
        problems,
        uploads,
        notifications,
        recent: recent.map((entry) => neighbour(entry)!),
        previous: neighbour(previous),
        next: neighbour(next),
        queue: queue.map((entry) => ({ id: entry.id, name: runRow(entry, null, null).name, starter: starterOf(entry.triggerType, entry.triggerLabel) })),
    };
}
