import prisma from "@/lib/prisma";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { stageLabel } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { formatterFor } from "@/lib/notifications/templates/format";
import type { BackupResultData, NotificationDestination, NotificationProblem } from "@/lib/notifications/types";
import { buildProblems } from "@/services/history/run-problems";
import type { RunnerContext } from "../types";

const log = logger.child({ step: "notification-data" });

/** Each destination of the run with how its upload went. */
function destinationsOf(ctx: RunnerContext): NotificationDestination[] {
    return ctx.destinations.map((dest) => {
        const result = dest.uploadResult;
        if (result?.success) return { name: dest.configName, adapterId: dest.adapterId, state: "ok", detail: "Uploaded" };
        if (result?.skipped) return { name: dest.configName, adapterId: dest.adapterId, state: "skipped", detail: "Not connected" };
        if (!result) return { name: dest.configName, adapterId: dest.adapterId, state: "skipped", detail: "Not reached" };
        return { name: dest.configName, adapterId: dest.adapterId, state: "failed", detail: "Upload failed", ...(result.error ? { error: result.error } : {}) };
    });
}

/** The first error of the log in plain words, the way the page of the run tells it. */
function problemOf(ctx: RunnerContext, timeZone: string): NotificationProblem | undefined {
    const { problems } = buildProblems(ctx.logs, [], {
        jobName: ctx.job?.name ?? null,
        destinations: ctx.destinations.map((dest) => ({ id: dest.configId, name: dest.configName })),
        sourceName: ctx.job?.source?.name ?? null,
        sourceId: ctx.job?.source?.id ?? null,
    });
    const problem = problems.find((entry) => entry.tone === "error");
    if (!problem) return undefined;
    const at = formatterFor({ timeZone }).clock(problem.at);
    return {
        title: problem.title,
        ...(problem.help ? { help: problem.help } : {}),
        raw: problem.raw,
        where: [stageLabel(problem.step), at].filter(Boolean).join(" · "),
    };
}

/** How many runs of the job failed in a row up to this one, and when it last ran clean. */
async function historyOf(jobId: string, executionId: string | undefined): Promise<{ failedInARow: number; lastSuccessAt?: string }> {
    try {
        const [recent, lastSuccess] = await Promise.all([
            prisma.execution.findMany({
                where: { jobId, status: { in: ["Success", "Partial", "Failed"] }, ...(executionId ? { id: { not: executionId } } : {}) },
                orderBy: { startedAt: "desc" },
                take: 50,
                select: { status: true },
            }),
            prisma.execution.findFirst({
                where: { jobId, status: "Success" },
                orderBy: { startedAt: "desc" },
                select: { startedAt: true, endedAt: true },
            }),
        ]);
        const earlier = recent.findIndex((run) => run.status !== "Failed");
        return {
            failedInARow: 1 + (earlier === -1 ? recent.length : earlier),
            ...(lastSuccess ? { lastSuccessAt: (lastSuccess.endedAt ?? lastSuccess.startedAt).toISOString() } : {}),
        };
    } catch (error) {
        log.warn("Could not read the earlier runs for a notification", { jobId }, wrapError(error));
        return { failedInARow: 1 };
    }
}

async function encryptionKeyOf(profileId: string | null | undefined): Promise<string | undefined> {
    if (!profileId) return undefined;
    try {
        const profile = await prisma.encryptionProfile.findUnique({ where: { id: profileId }, select: { name: true } });
        return profile?.name;
    } catch (error) {
        log.warn("Could not read the encryption key for a notification", { profileId }, wrapError(error));
        return undefined;
    }
}

/** What the notification of a finished run says about it. */
export async function backupEventData(ctx: RunnerContext, failed: boolean, timeZone: string): Promise<BackupResultData> {
    const job = ctx.job!;
    const source = job.source;
    const adapterName = source ? ADAPTER_DEFINITIONS.find((definition) => definition.id === source.adapterId)?.name : undefined;
    const version = typeof ctx.metadata?.engineVersion === "string" ? ctx.metadata.engineVersion : undefined;
    const history = failed ? await historyOf(job.id, ctx.execution?.id) : undefined;
    return {
        jobName: job.name,
        jobId: job.id,
        sourceName: source?.name,
        ...(adapterName ? { sourceType: version ? `${adapterName} ${version}` : adapterName } : {}),
        duration: Date.now() - ctx.startedAt.getTime(),
        size: ctx.dumpSize ? Number(ctx.dumpSize) : undefined,
        executionId: ctx.execution?.id,
        timestamp: new Date().toISOString(),
        startedAt: ctx.startedAt.toISOString(),
        trigger: ctx.execution?.triggerType ?? undefined,
        ...(typeof ctx.metadata?.count === "number" && ctx.metadata.count > 0 ? { databases: ctx.metadata.count } : {}),
        encryptionKey: await encryptionKeyOf(job.encryptionProfileId),
        destinations: destinationsOf(ctx),
        problem: problemOf(ctx, timeZone),
        ...(history ?? {}),
    };
}
