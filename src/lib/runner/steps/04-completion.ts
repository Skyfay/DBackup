import { RunnerContext } from "../types";
import prisma from "@/lib/prisma";
import fs from "fs/promises";
import { registry } from "@/lib/core/registry";
import { NotificationAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { renderTemplate, NOTIFICATION_EVENTS } from "@/lib/notifications";
import { recordNotificationLog } from "@/services/notifications/notification-log-service";
import { PIPELINE_STAGES } from "@/lib/core/logs";

const log = logger.child({ step: "04-completion" });

const NOTIFICATION_TIMEOUT_MS = 30_000;

function notifyWithTimeout(send: () => Promise<unknown>): Promise<unknown> {
    return Promise.race([
        send(),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Notification send timed out after 30s")),
                NOTIFICATION_TIMEOUT_MS
            )
        ),
    ]);
}

export async function stepCleanup(ctx: RunnerContext) {
    // 1. Filesystem Cleanup
    if (ctx.tempFile) {
        try {
            await fs.access(ctx.tempFile);
            await fs.unlink(ctx.tempFile);
            ctx.log("Temporary file cleaned up");
        } catch (_e) {
            // File doesn't exist or cleanup failed - ignore
        }
    }

    // The archive index sidecar, when the combined dump path produced one.
    if (ctx.indexFile) {
        await fs.unlink(ctx.indexFile).catch(() => {
            // File doesn't exist or cleanup failed - ignore, same as the archive above
        });
    }
}

export async function stepFinalize(ctx: RunnerContext) {
    if (!ctx.execution) return;

    // Build per-destination results for metadata
    const destinationResults = ctx.destinations.map(d => ({
        configId: d.configId,
        name: d.configName,
        adapterId: d.adapterId,
        path: d.uploadResult?.path,
        status: d.uploadResult?.success ? "success" : (d.uploadResult ? "failed" : "skipped"),
        error: d.uploadResult?.error,
    }));

    const executionMetadata = {
        ...ctx.metadata,
        destinations: destinationResults,
    };

    // 1. Update Execution Record
    await prisma.execution.update({
        where: { id: ctx.execution.id },
        data: {
            status: ctx.status,
            endedAt: new Date(),
            logs: JSON.stringify(ctx.logs),
            size: ctx.dumpSize,
            path: ctx.finalRemotePath,
            metadata: JSON.stringify(executionMetadata)
        }
    });

    // 2. Refresh storage statistics cache (non-blocking)
    if (ctx.status === "Success" || ctx.status === "Partial") {
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache().catch((e) => {
                log.warn("Failed to refresh storage stats cache after backup", {}, e instanceof Error ? e : undefined);
            });
        });
    }

    // 3. Notifications
    const isSuccess = ctx.status === "Success";
    const isPartial = ctx.status === "Partial";
    const executionStatus = isSuccess ? "SUCCESS" : isPartial ? "PARTIAL" : "FAILED";

    // Build the list of channels to notify.
    // New path: template-based (preferred when templates are configured).
    // Legacy path: flat channel list on the job (kept for backward compat).
    type ChannelToNotify = { channel: import("@prisma/client").AdapterConfig; events: Set<string> };
    const channelsToNotify: ChannelToNotify[] = [];

    if (ctx.job) {
        if (ctx.job.notificationTemplates && ctx.job.notificationTemplates.length > 0) {
            // Template path: each channel in each template has its own event filter.
            for (const jobTemplate of ctx.job.notificationTemplates) {
                for (const ch of jobTemplate.template.channels) {
                    const eventsForChannel = new Set(ch.events.split("|"));
                    if (eventsForChannel.has(executionStatus)) {
                        channelsToNotify.push({ channel: ch.config as any, events: eventsForChannel });
                    }
                }
            }
        } else if (ctx.job.notifications && ctx.job.notifications.length > 0) {
            // Legacy path: global event filter applies to all channels.
            const rawEvents = ctx.job.notificationEvents || "SUCCESS|PARTIAL|FAILED";
            const legacyMap: Record<string, string> = {
                ALWAYS: "SUCCESS|PARTIAL|FAILED",
                FAILURE_ONLY: "PARTIAL|FAILED",
                SUCCESS_ONLY: "SUCCESS",
            };
            const normalizedEvents = legacyMap[rawEvents] ?? rawEvents;
            const events = new Set(normalizedEvents.split("|"));
            if (events.has(executionStatus)) {
                for (const ch of ctx.job.notifications) {
                    channelsToNotify.push({ channel: ch as any, events });
                }
            } else {
                ctx.log(`Skipping notifications - event filter (${rawEvents}) does not match status (${executionStatus})`);
            }
        }
    }

    if (channelsToNotify.length > 0 && ctx.job) {
        ctx.setStage(PIPELINE_STAGES.NOTIFICATIONS);
        ctx.log("Sending notifications...");

        const eventType = isSuccess
            ? NOTIFICATION_EVENTS.BACKUP_SUCCESS
            : isPartial
                ? NOTIFICATION_EVENTS.BACKUP_PARTIAL
                : NOTIFICATION_EVENTS.BACKUP_FAILURE;

        const destSummary = ctx.destinations.map(d => {
            const status = d.uploadResult?.success ? "✓" : "✗";
            return `${status} ${d.configName}`;
        }).join(", ");

        for (const { channel } of channelsToNotify) {
            try {
                const notifyAdapter = registry.get(channel.adapterId) as NotificationAdapter;

                if (notifyAdapter) {
                    const channelConfig = await resolveAdapterConfig(channel) as any;

                    const payload = renderTemplate({
                        eventType,
                        data: {
                            jobName: ctx.job.name,
                            sourceName: ctx.job.source?.name,
                            duration: new Date().getTime() - ctx.startedAt.getTime(),
                            size: ctx.dumpSize ? Number(ctx.dumpSize) : undefined,
                            error: !isSuccess && !isPartial ? ctx.logs.find(l => l.level === 'error')?.message : undefined,
                            executionId: ctx.execution?.id,
                            timestamp: new Date().toISOString(),
                            ...(isPartial ? { error: `Partial upload: ${destSummary}` } : {}),
                        },
                    });

                    let renderedPayload: string | undefined;
                    let renderedHtml: string | undefined;

                    if (channel.adapterId === "email") {
                        try {
                            const { renderToStaticMarkup } = await import("react-dom/server");
                            const { SystemNotificationEmail } = await import(
                                "@/components/email/system-notification-template"
                            );
                            const React = await import("react");
                            renderedHtml = renderToStaticMarkup(
                                React.createElement(SystemNotificationEmail, {
                                    title: payload.title,
                                    message: payload.message,
                                    fields: payload.fields,
                                    color: payload.color,
                                    success: payload.success,
                                    badge: payload.badge,
                                })
                            );
                        } catch { /* non-critical */ }
                    } else if (channel.adapterId === "discord") {
                        const color = payload.color
                            ? parseInt(payload.color.replace("#", ""), 16)
                            : payload.success ? 0x00ff00 : 0xff0000;
                        renderedPayload = JSON.stringify({
                            embeds: [{
                                title: payload.title || "Notification",
                                description: payload.message,
                                color,
                                timestamp: new Date().toISOString(),
                                fields: (payload.fields || []).map((f: { name: string; value: string; inline?: boolean }) => ({
                                    name: f.name, value: f.value, inline: f.inline ?? true,
                                })),
                            }],
                        });
                    } else if (channel.adapterId === "slack") {
                        const colorHex = payload.color
                            ? payload.color.replace("#", "")
                            : payload.success ? "00ff00" : "ff0000";
                        renderedPayload = JSON.stringify({
                            attachments: [{
                                color: `#${colorHex}`,
                                blocks: [
                                    { type: "header", text: { type: "plain_text", text: payload.title || "Notification" } },
                                    { type: "section", text: { type: "mrkdwn", text: payload.message } },
                                    ...(payload.fields?.length ? [{
                                        type: "section",
                                        fields: payload.fields.map((f: { name: string; value: string }) => ({
                                            type: "mrkdwn", text: `*${f.name}:*\n${f.value || "-"}`,
                                        })),
                                    }] : []),
                                ],
                            }],
                        });
                    }

                    const sent = await notifyWithTimeout(() => notifyAdapter.send(channelConfig, payload.message, {
                        success: payload.success,
                        eventType,
                        title: payload.title,
                        fields: payload.fields,
                        color: payload.color,
                        badge: payload.badge,
                    }));
                    if (sent === false) {
                        throw new Error("Notification delivery failed (adapter returned false)");
                    }

                    await recordNotificationLog({
                        eventType,
                        channelId: channel.id,
                        channelName: channel.name,
                        adapterId: channel.adapterId,
                        status: "Success",
                        title: payload.title,
                        message: payload.message,
                        fields: payload.fields,
                        color: payload.color,
                        renderedHtml,
                        renderedPayload,
                        executionId: ctx.execution?.id,
                    });
                }
            } catch (e) {
                log.error("Failed to send notification", { channelName: channel.name }, wrapError(e));
                ctx.log(`Failed to send notification to channel ${channel.name}`);

                await recordNotificationLog({
                    eventType,
                    channelId: channel.id,
                    channelName: channel.name,
                    adapterId: channel.adapterId,
                    status: "Failed",
                    title: "Backup Notification",
                    message: "",
                    error: getErrorMessage(e),
                    executionId: ctx.execution?.id,
                });
            }
        }
    }
}
