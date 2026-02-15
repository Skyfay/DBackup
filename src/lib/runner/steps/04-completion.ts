import { RunnerContext } from "../types";
import prisma from "@/lib/prisma";
import fs from "fs";
import { registry } from "@/lib/core/registry";
import { NotificationAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import { renderTemplate, NOTIFICATION_EVENTS } from "@/lib/notifications";

const log = logger.child({ step: "04-completion" });

export async function stepCleanup(ctx: RunnerContext) {
    // 1. Filesystem Cleanup
    if (ctx.tempFile && fs.existsSync(ctx.tempFile)) {
        try {
            fs.unlinkSync(ctx.tempFile);
            ctx.log("Temporary file cleaned up");
        } catch (_e) {
            ctx.log("Warning: Failed to cleanup temp file");
        }
    }
}

export async function stepFinalize(ctx: RunnerContext) {
    if (!ctx.execution) return;

    // 1. Update Execution Record
    await prisma.execution.update({
        where: { id: ctx.execution.id },
        data: {
            status: ctx.status,
            endedAt: new Date(),
            logs: JSON.stringify(ctx.logs), // Should be serialized JSON
            size: ctx.dumpSize,
            path: ctx.finalRemotePath,
            metadata: ctx.metadata ? JSON.stringify(ctx.metadata) : null
        }
    });

    // 2. Refresh storage statistics cache (non-blocking)
    if (ctx.status === "Success") {
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache().catch((e) => {
                log.warn("Failed to refresh storage stats cache after backup", {}, e instanceof Error ? e : undefined);
            });
        });
    }

    // 3. Notifications
    if (ctx.job && ctx.job.notifications && ctx.job.notifications.length > 0) {
        const condition = ctx.job.notificationEvents || "ALWAYS";
        const isSuccess = ctx.status === "Success";
        const shouldNotify =
            condition === "ALWAYS" ||
            (condition === "SUCCESS_ONLY" && isSuccess) ||
            (condition === "FAILURE_ONLY" && !isSuccess);

        if (!shouldNotify) {
            ctx.log(`Skipping notifications. Condition: ${condition}, Status: ${ctx.status}`);
        } else {
            ctx.log("Sending notifications...");

            for (const channel of ctx.job.notifications) {
                try {
                    const notifyAdapter = registry.get(channel.adapterId) as NotificationAdapter;

                    if (notifyAdapter) {
                        const channelConfig = decryptConfig(JSON.parse(channel.config));
                        const isSuccess = ctx.status === "Success";

                        const payload = renderTemplate({
                            eventType: isSuccess
                                ? NOTIFICATION_EVENTS.BACKUP_SUCCESS
                                : NOTIFICATION_EVENTS.BACKUP_FAILURE,
                            data: {
                                jobName: ctx.job.name,
                                sourceName: ctx.job.source?.name,
                                duration: new Date().getTime() - ctx.startedAt.getTime(),
                                size: ctx.dumpSize ? Number(ctx.dumpSize) : undefined,
                                error: !isSuccess ? ctx.logs.find(l => l.level === 'error')?.message : undefined,
                                executionId: ctx.execution?.id,
                                timestamp: new Date().toISOString(),
                            },
                        });

                        await notifyAdapter.send(channelConfig, payload.message, {
                            success: payload.success,
                            eventType: isSuccess
                                ? NOTIFICATION_EVENTS.BACKUP_SUCCESS
                                : NOTIFICATION_EVENTS.BACKUP_FAILURE,
                            title: payload.title,
                            fields: payload.fields,
                            color: payload.color,
                        });
                    }
                } catch (e) {
                    log.error("Failed to send notification", { channelName: channel.name }, wrapError(e));
                    ctx.log(`Failed to send notification to channel ${channel.name}`);
                }
            }
        }
    }
}
