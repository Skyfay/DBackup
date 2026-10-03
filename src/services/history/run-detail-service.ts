import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { buildChecks, type CheckTarget } from "./run-checks";
import { dumpRecordsOf, dumpSizes } from "./run-dumps";
import { markSteps, buildProblems, type ProblemTargets } from "./run-problems";
import { databasesOf, isRunStatus, liveOf, parseMetadata, runRow, starterOf, uploadsOf } from "./run-row";
import { buildSteps, median, parseLog, usualSteps } from "./run-steps";
import { buildSummary } from "./run-summary";
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
            _count: { select: { sources: true } },
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

/**
 * The copies of a finished backup, from what its last step recorded for every destination, with
 * the times of the upload list where the run kept it. Runs that lost the record of their last step
 * to a late write of their log still have the upload list of their live state.
 */
function finishedUploads(metadata: ReturnType<typeof parseMetadata>, size: number | null): RunUpload[] {
    const timed = uploadsOf(metadata);
    if (!Array.isArray(metadata.destinations)) return timed;
    return (metadata.destinations as { configId?: string; name?: string; adapterId?: string; status?: string; error?: string }[]).map((entry) => {
        const times = timed.find((upload) => upload.configId === entry.configId);
        return {
            configId: entry.configId ?? "",
            name: entry.name ?? "A destination",
            adapterId: entry.adapterId ?? "",
            state: entry.status === "success" ? "done" : entry.status === "failed" ? "failed" : "skipped",
            bytes: entry.status === "success" ? size : null,
            total: size,
            error: entry.error ?? null,
            startedAt: times?.startedAt ?? null,
            endedAt: times?.endedAt ?? null,
        };
    });
}

/** The size of each dump in the last successful backup of the job that recorded them. */
async function previousDumps(jobId: string, before: Date): Promise<Map<string, number>> {
    const run = await prisma.execution.findFirst({
        where: { jobId, status: "Success", startedAt: { lt: before }, metadata: { contains: "\"dumps\"" } },
        orderBy: { startedAt: "desc" },
        select: { metadata: true },
    });
    const metadata = parseMetadata(run?.metadata ?? null) as { dumps?: unknown };
    return dumpSizes(dumpRecordsOf(metadata.dumps));
}

/** The name of the key an archive was encrypted with, true when the key is gone, null for an archive in the clear. */
async function encryptionOf(archive: unknown): Promise<string | true | null> {
    const value = archive as { encrypted?: unknown; profileId?: unknown } | undefined;
    if (!value?.encrypted) return null;
    if (typeof value.profileId !== "string") return true;
    const profile = await prisma.encryptionProfile.findUnique({ where: { id: value.profileId }, select: { name: true } });
    return profile?.name ?? true;
}

/** The destinations an integrity check or a verification went through, with whether each checks a copy by itself. */
async function checkTargets(metadata: { plan?: unknown; copies?: unknown }): Promise<Map<string, CheckTarget>> {
    const ids = new Set<string>();
    for (const copy of Array.isArray(metadata.copies) ? metadata.copies : []) if (typeof copy?.destinationId === "string") ids.add(copy.destinationId);
    const planned = (metadata.plan as { destinations?: { id?: unknown }[] } | undefined)?.destinations ?? [];
    for (const entry of planned) if (typeof entry?.id === "string") ids.add(entry.id);
    if (ids.size === 0) return new Map();
    const [configs, { checksNatively }] = await Promise.all([
        prisma.adapterConfig.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, adapterId: true } }),
        import("@/services/storage/verification-service"),
    ]);
    return new Map(configs.map((config) => [config.id, { name: config.name, adapterId: config.adapterId, native: checksNatively(config.adapterId) }]));
}

/**
 * Whether a step belongs to the job at all. A job without a database never dumps, one without
 * folders never collects files, so those steps are left out instead of shown as skipped.
 */
function appliesTo(step: string, job: { source: unknown; sources: unknown[] } | null, entries: { stage?: string }[]): boolean {
    if (step === "Dumping Databases") return job ? job.source !== null : entries.some((entry) => entry.stage === step);
    if (step === "Collecting Files") return job ? job.sources.length > 0 : entries.some((entry) => entry.stage === step);
    return true;
}

/** The runs a run is compared with: those of its job, or for a system task those of the same task. */
function scopeOf(record: { jobId: string | null; type: string }): Prisma.ExecutionWhereInput | null {
    if (record.jobId) return { jobId: record.jobId };
    return record.type === "IntegrityCheck" || record.type === "Verification" ? { type: record.type, jobId: null } : null;
}

async function usualStepsOf(scope: Prisma.ExecutionWhereInput, exclude: string) {
    const runs = await prisma.execution.findMany({
        where: { ...scope, status: "Success", id: { not: exclude }, logsPurgedAt: null },
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
    const extra = metadata as Record<string, unknown>;
    const entries = parseLog(record.logs);
    const status = isRunStatus(record.status) ? record.status : "Failed";
    const live = status === "Running" || status === "Pending";
    const jobId = record.jobId;
    const scope = scopeOf(record);
    const isCheck = record.type === "IntegrityCheck" || record.type === "Verification";

    const [notificationRows, usual, usualMs, recent, previous, next, queue, sizes, encryption, checkTargetMap] = await Promise.all([
        prisma.notificationLog.findMany({ where: { executionId: id }, orderBy: { sentAt: "asc" }, select: { id: true, channelId: true, channelName: true, adapterId: true, status: true, error: true, title: true, sentAt: true } }),
        scope ? usualStepsOf(scope, id) : Promise.resolve(new Map<string, number>()),
        jobId && record.type === "Backup" ? usualOf(jobId) : Promise.resolve(null),
        scope ? prisma.execution.findMany({ where: scope, orderBy: { startedAt: "desc" }, take: RECENT, select: NEIGHBOUR_SELECT }) : Promise.resolve([]),
        scope ? prisma.execution.findFirst({ where: { ...scope, startedAt: { lt: record.startedAt } }, orderBy: { startedAt: "desc" }, select: NEIGHBOUR_SELECT }) : Promise.resolve(null),
        scope ? prisma.execution.findFirst({ where: { ...scope, startedAt: { gt: record.startedAt } }, orderBy: { startedAt: "asc" }, select: NEIGHBOUR_SELECT }) : Promise.resolve(null),
        status === "Running" ? prisma.execution.findMany({ where: { status: "Pending" }, orderBy: { startedAt: "asc" }, select: RUN_SELECT }) : Promise.resolve([]),
        jobId && record.type === "Backup" ? previousDumps(jobId, record.startedAt) : Promise.resolve(new Map<string, number>()),
        encryptionOf(extra.archive),
        isCheck ? checkTargets(extra) : Promise.resolve(new Map<string, CheckTarget>()),
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
    // A removed log leaves no steps to tell, which is not the same as steps that were skipped.
    const steps = record.logsPurgedAt ? [] : buildSteps(entries, { type: record.type, status, currentStage: liveOf(metadata).stage, now, usual })
        .filter((step) => step.lines.length > 0 || appliesTo(step.name, record.job, entries));
    const { problems, lineProblems } = buildProblems(entries, notifications, targets);

    let uploads = live ? uploadsOf(metadata) : finishedUploads(metadata, record.size === null ? null : Number(record.size));
    if (uploads.length === 0 && live && record.type === "Backup") {
        uploads = (record.job?.destinations ?? []).map((entry) => ({
            configId: entry.configId, name: entry.config.name, adapterId: entry.config.adapterId, state: "waiting", bytes: null, total: null, error: null, startedAt: null, endedAt: null,
        }));
    }

    const marked = markSteps(steps, lineProblems, problems);
    const size = record.size === null ? null : Number(record.size);
    const checks = buildChecks(record.type, extra, checkTargetMap, live);
    const summary = checks ? [] : buildSummary({
        entries,
        steps: marked,
        records: dumpRecordsOf(extra.dumps),
        names: databasesOf(metadata),
        engineVersion: typeof extra.engineVersion === "string" ? extra.engineVersion : null,
        compression: typeof (extra.archive as { compression?: unknown } | undefined)?.compression === "string" ? (extra.archive as { compression: string }).compression : null,
        encryption,
        uploads,
        notifications,
        sourceName: record.job?.source?.name ?? null,
        folders: record.job?._count.sources ?? 0,
        size,
        previous: sizes,
        detail: liveOf(metadata).detail,
        live,
        now,
    });

    // A system task has no job to take a usual time from, so it compares with the runs of the same task.
    const usualTaskMs = isCheck ? median(recent.filter((entry) => entry.id !== id && entry.status === "Success" && entry.endedAt).map((entry) => entry.endedAt!.getTime() - entry.startedAt.getTime())) : null;
    const firstError = problems.find((problem) => problem.tone === "error");
    const row = runRow(record, usualMs ?? usualTaskMs, firstError ? firstError.title : null);
    return {
        ...row,
        job: record.job ? { id: record.job.id, name: record.job.name } : null,
        path: record.path,
        backupType: record.backupType,
        logsPurgedAt: record.logsPurgedAt?.toISOString() ?? null,
        databases: databasesOf(metadata),
        steps: marked,
        summary,
        problems,
        uploads,
        checks,
        notifications,
        recent: recent.map((entry) => neighbour(entry)!),
        previous: neighbour(previous),
        next: neighbour(next),
        queue: queue.map((entry) => ({ id: entry.id, name: runRow(entry, null, null).name, starter: starterOf(entry.triggerType, entry.triggerLabel) })),
    };
}
