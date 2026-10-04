/**
 * The dots of the History tabs. A job whose newest finished backup failed, or missed a copy, and a
 * channel whose newest message failed. A failure that ran through since needs no look, so the dots
 * follow the newest run of each job and the newest message of each channel, not the last 30 days.
 */

import prisma from "@/lib/prisma";
import { attentionOf, combineAttention, type TabAttention } from "@/lib/core/tab-attention";

const FINISHED = ["Success", "Failed", "Partial", "Cancelled"];

export interface HistoryAttention {
    runs?: TabAttention;
    notifications?: TabAttention;
}

export async function getHistoryAttention(): Promise<HistoryAttention> {
    const [newestRuns, newestMessages] = await Promise.all([
        prisma.execution.groupBy({
            by: ["jobId"],
            where: { jobId: { not: null }, type: "Backup", status: { in: FINISHED } },
            _max: { startedAt: true },
        }),
        prisma.notificationLog.groupBy({
            by: ["channelId"],
            where: { channelId: { not: null } },
            _max: { sentAt: true },
        }),
    ]);

    const [runs, messages] = await Promise.all([
        newestRuns.length === 0
            ? []
            : prisma.execution.findMany({
                  where: {
                      type: "Backup",
                      status: { in: ["Failed", "Partial"] },
                      OR: newestRuns.map((row) => ({ jobId: row.jobId, startedAt: row._max.startedAt ?? undefined })),
                  },
                  select: { status: true, job: { select: { name: true } } },
              }),
        newestMessages.length === 0
            ? []
            : prisma.notificationLog.findMany({
                  where: {
                      status: "Failed",
                      OR: newestMessages.map((row) => ({ channelId: row.channelId, sentAt: row._max.sentAt ?? undefined })),
                  },
                  select: { channelId: true },
              }),
    ]);

    // The channel by its name of now, and only while it still exists.
    const channelIds = [...new Set(messages.map((message) => message.channelId).filter((id): id is string => id !== null))];
    const channels = channelIds.length === 0
        ? []
        : await prisma.adapterConfig.findMany({ where: { id: { in: channelIds } }, select: { name: true }, orderBy: { name: "asc" } });

    const jobs = (status: string) => runs.filter((run) => run.status === status && run.job).map((run) => run.job!.name).sort((a, b) => a.localeCompare(b));
    return {
        runs: combineAttention(
            attentionOf("destructive", jobs("Failed"), "failed on its last run", "failed on their last run"),
            attentionOf("warning", jobs("Partial"), "missed a copy on its last run", "missed a copy on their last run"),
        ),
        notifications: attentionOf("destructive", channels.map((channel) => channel.name), "failed to send its last message", "failed to send their last message"),
    };
}
