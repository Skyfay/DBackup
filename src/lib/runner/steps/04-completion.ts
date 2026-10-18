import { RunnerContext } from "../types";
import prisma from "@/lib/prisma";
import fs from "fs/promises";
import { registry } from "@/lib/core/registry";
import { NotificationAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { renderTemplate, NOTIFICATION_EVENTS } from "@/lib/notifications";
import type { NotificationEventData } from "@/lib/notifications/types";
import { recordNotificationLog } from "@/services/notifications/notification-log-service";
import { PIPELINE_STAGES } from "@/lib/core/logs";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { jobReason } from "@/services/notifications/notification-reason";
import { loadNotificationBrand } from "@/lib/notifications/brand";
import { backupEventData } from "./notification-data";
import { channelTarget } from "@/services/sharing/channel-recipients";
import { SHARED_FAILURE } from "@/services/notifications/channel-send";

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

    // The run's own directory, with anything a step left in it.
    if (ctx.runDir) {
        await fs.rm(ctx.runDir, { recursive: true, force: true }).catch(() => {
            // Cleanup failed - ignore, same as the files above
        });
    }

    // 2. Release every snapshot this run created.
    //
    // This function runs from the runner's `finally`, so it covers success, failure and
    // cancellation. A snapshot left behind consumes space on the file server and blocks
    // the next backup of that share, so each release is attempted independently and a
    // failure is logged rather than thrown - it must not turn an otherwise good backup
    // into a failed one.
    for (const shadow of ctx.shadowCopies ?? []) {
        // The collection releases each group the moment it is done, so most snapshots are
        // already gone by the time this runs. Only the ones it could not release - and every
        // one at all when the run died mid-collection - are still open here.
        if (shadow.released) continue;
        // A shadow copy and a helper container are not the same thing, and this path in
        // particular runs after a failure, where a vague word costs someone time.
        const noun = shadow.handle.noun ?? "snapshot";
        const prefix = `[${shadow.configName}]`;
        try {
            // The adapter gets the log too. This is the path a killed run ends on, so what
            // it puts back - restarted containers above all - has to be visible.
            await shadow.adapter.releaseSnapshot?.(
                shadow.config,
                shadow.handle,
                (msg, level, type, details) => ctx.log(`${prefix} ${msg}`, level, type ?? 'storage', details),
            );
            ctx.log(`${prefix} Released the ${noun}`, 'info', 'storage');
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            ctx.log(
                `${prefix} Could not release the ${noun} (${shadow.handle.label}): ${message}. It may have to be removed on the server.`,
                'warning', 'storage'
            );
        }
    }
    ctx.shadowCopies = [];
}

export async function stepFinalize(ctx: RunnerContext) {
    if (!ctx.execution) return;

    // Build per-destination results for metadata
    const destinationResults = ctx.destinations.map(d => ({
        configId: d.configId,
        name: d.configName,
        adapterId: d.adapterId,
        path: d.uploadResult?.path,
        status: d.uploadResult?.success ? "success" : (d.uploadResult && !d.uploadResult.skipped ? "failed" : "skipped"),
        error: d.uploadResult?.error,
        // Left out on purpose, so no page counts it as a copy that should be there.
        ...(d.uploadResult?.skipped ? { airGapped: true } : {}),
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
            metadata: JSON.stringify(executionMetadata),
            // Chain bookkeeping. Only set for incremental-mode jobs; a full-mode job
            // leaves these null, which is what marks a backup as standalone.
            ...(ctx.chain && ctx.job?.backupMode === "INCREMENTAL"
                ? {
                    backupType: ctx.chain.type === "full" ? "Full" : "Incremental",
                    chainId: ctx.chain.chainId,
                    baseArchive: ctx.chain.baseArchive ?? null,
                    chainIndex: ctx.chain.index,
                    // The complete snapshot size, as opposed to `size` which is what this
                    // archive physically stores. The Backups page shows this one.
                    logicalSize: typeof ctx.metadata?.logicalSize === "number" ? ctx.metadata.logicalSize : null,
                }
                : {}),
        }
    });

    // The run that follows this one ends with it, before the notifications, which can take a while.
    await ctx.follower?.end({ status: ctx.status, dumps: ctx.metadata?.dumps }).catch((error: unknown) => {
        log.error("Ending the run that follows this one failed", { executionId: ctx.execution?.id }, wrapError(error));
    });

    // The dashboard caches its charts and counts. This run changes them, whatever its outcome.
    invalidateDashboardCache();

    // 2. Refresh storage statistics cache of the destinations of this run (non-blocking)
    if (ctx.status === "Success" || ctx.status === "Partial") {
        const configIds = ctx.destinations.map((destination) => destination.configId);
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache({ configIds }).catch((e) => {
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

    const eventType = isSuccess
        ? NOTIFICATION_EVENTS.BACKUP_SUCCESS
        : isPartial
            ? NOTIFICATION_EVENTS.BACKUP_PARTIAL
            : NOTIFICATION_EVENTS.BACKUP_FAILURE;

    // The tenant of the job hears about the run on its own channels too, once it picked any for it
    // in its settings. The home tenant does not, its jobs report through their own channels.
    const tenantId = ctx.job?.tenantId;
    const tenantHears = tenantId
        ? await import("@/services/notifications/tenant-notification-settings")
            .then(({ tenantHearsAbout }) => tenantHearsAbout(tenantId, eventType))
            .catch((e: unknown) => {
                log.warn("Could not read the notifications of the tenant", { tenantId }, wrapError(e));
                return false;
            })
        : false;

    if ((channelsToNotify.length > 0 || tenantHears) && ctx.job) {
        ctx.setStage(PIPELINE_STAGES.NOTIFICATIONS);
        ctx.log("Sending notifications...");

        // What the run did, read once for every channel.
        const brand = await loadNotificationBrand();
        const job = ctx.job;
        const data = await backupEventData(ctx, !isSuccess && !isPartial, brand.timeZone).catch((e: unknown) => {
            // The notification still goes out with what the run knows for sure.
            log.warn("Could not gather the details of the run for its notification", { jobId: job.id }, wrapError(e));
            return { jobName: job.name, jobId: job.id, executionId: ctx.execution?.id, timestamp: new Date().toISOString() };
        });
        // Its links name the tenant of the job, so they open the run there from any other tenant.
        const basePayload = renderTemplate({ eventType, data }, { timeZone: brand.timeZone, tenantId });

        for (const { channel, events } of channelsToNotify) {
            try {
                const notifyAdapter = registry.get(channel.adapterId) as NotificationAdapter;

                if (notifyAdapter) {
                    // A channel another tenant shares sends where the tenant of the job named, or nowhere.
                    const target = await channelTarget(channel, tenantId);
                    if (target.refusal) throw new Error(target.refusal);
                    const channelConfig = { ...(await resolveAdapterConfig(channel) as any), ...(target.to ? { to: target.to } : {}) };
                    const payload = { ...basePayload, reason: jobReason(channel.name, ctx.job.name, events) };

                    let renderedPayload: string | undefined;
                    let renderedHtml: string | undefined;

                    if (channel.adapterId === "email") {
                        try {
                            const { renderNotificationEmail } = await import("@/components/email/render-email");
                            renderedHtml = (await renderNotificationEmail(payload, brand)).html;
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

                    const sent = await notifyWithTimeout(() => notifyAdapter.send(channelConfig, payload.message, { ...payload, eventType, brand }));
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
                        tenantId,
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
                    // Why the server of the tenant that shares the channel refused it stays with that tenant.
                    error: channel.tenantId !== tenantId && !(e instanceof Error && /shared with this tenant|No recipients/.test(e.message)) ? SHARED_FAILURE : getErrorMessage(e),
                    executionId: ctx.execution?.id,
                    tenantId,
                });
            }
        }

        if (tenantHears && tenantId) {
            // Only the channels of the tenant, the platform hears about runs through the jobs alone.
            const { notify } = await import("@/services/notifications/system-notification-service");
            // A channel the job told already gets it once.
            const skipChannelIds = channelsToNotify.map(({ channel }) => channel.id);
            const sent = await notify({ eventType, data } as NotificationEventData, { executionId: ctx.execution?.id, tenantId, platform: false, skipChannelIds });
            if (sent && sent.failed > 0) ctx.log(`${sent.failed} channel(s) of the tenant did not take the notification`);
        }
    }
}
