/**
 * The dots of the History tabs. A job whose newest finished backup failed, or missed a copy, and a
 * channel whose newest message failed. A failure that ran through since needs no look, so the dots
 * follow the newest run of each job and the newest message of each channel, not the last 30 days.
 */

import prisma from "@/lib/prisma";
import { attentionOf, combineAttention, type TabAttention } from "@/lib/core/tab-attention";
import { currentTenantId } from "@/lib/tenant/current";
import { providedTo } from "@/services/sharing/provided";
import { newestBackupIds, readInChunks } from "./newest-runs";

const FINISHED = ["Success", "Failed", "Partial", "Cancelled"];
const TROUBLED = ["Failed", "Partial"];

export interface HistoryAttention {
    runs?: TabAttention;
    notifications?: TabAttention;
}

/**
 * The names of these channels as they are now, sorted: the own ones and those another tenant still
 * shares with the tenant that runs now. A channel that is gone, or no longer shared, has none.
 */
async function channelNames(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const own = await prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const found = new Set(own.map((channel) => channel.id));
    const missing = ids.filter((id) => !found.has(id));
    const tenantId = missing.length > 0 ? await currentTenantId() : null;
    const shared = tenantId ? await providedTo(tenantId, { kind: "channel", ids: missing }) : [];
    return [...own, ...shared].map((channel) => channel.name).sort((a, b) => a.localeCompare(b));
}

/** How many channels one query of their newest messages names, far below where SQLite refuses the condition. */
const CHANNELS_PER_QUERY = 500;

/**
 * The channels whose newest message failed. The newest message of each comes from a `groupBy`,
 * matched in chunks, since a condition with one branch per channel failed past 10,000 with
 * "Expression tree is too large".
 */
async function failedChannels(): Promise<string[]> {
    const newest = await prisma.notificationLog.groupBy({
        by: ["channelId"],
        where: { channelId: { not: null } },
        _max: { sentAt: true },
    });
    const keys = newest.flatMap((row) => (row.channelId && row._max.sentAt ? [{ channelId: row.channelId, sentAt: row._max.sentAt }] : []));
    const failed: string[] = [];
    for (let start = 0; start < keys.length; start += CHANNELS_PER_QUERY) {
        const messages = await prisma.notificationLog.findMany({
            where: { status: "Failed", OR: keys.slice(start, start + CHANNELS_PER_QUERY) },
            select: { channelId: true },
        });
        for (const message of messages) if (message.channelId) failed.push(message.channelId);
    }
    return [...new Set(failed)];
}

/**
 * The jobs whose newest finished backup failed or missed a copy, by their name. A run of some
 * databases alone, like one a customer started, says nothing of the job as a whole.
 */
async function troubledJobs(): Promise<{ status: string; name: string }[]> {
    const jobs = await prisma.job.findMany({ select: { id: true, name: true } });
    const names = new Map(jobs.map((job) => [job.id, job.name]));
    const newest = await newestBackupIds([...names.keys()], { statuses: FINISHED, wholeJob: true, keepOnly: TROUBLED });
    const runs = await readInChunks(newest, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { status: true, jobId: true },
    }));
    return runs.flatMap((run) => {
        const name = run.jobId ? names.get(run.jobId) : undefined;
        return name === undefined || !TROUBLED.includes(run.status) ? [] : [{ status: run.status, name }];
    });
}

export async function getHistoryAttention(): Promise<HistoryAttention> {
    const [runs, channelIds] = await Promise.all([troubledJobs(), failedChannels()]);

    // The channel by its name of now, and only while it still exists.
    const channels = await channelNames(channelIds);

    const jobs = (status: string) => runs.filter((run) => run.status === status).map((run) => run.name).sort((a, b) => a.localeCompare(b));
    return {
        runs: combineAttention(
            attentionOf("destructive", jobs("Failed"), "failed on its last run", "failed on their last run"),
            attentionOf("warning", jobs("Partial"), "missed a copy on its last run", "missed a copy on their last run"),
        ),
        notifications: attentionOf("destructive", channels, "failed to send its last message", "failed to send their last message"),
    };
}
