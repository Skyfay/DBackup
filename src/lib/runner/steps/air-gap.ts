import prisma from "@/lib/prisma";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runConnectivityCheck } from "@/lib/transport/adapter-invoke";
import type { DestinationContext, RunnerContext } from "../types";

/**
 * What a run does with an air-gapped destination, one that is connected only now and then (see
 * `lib/core/air-gap.ts`). Right before its upload the run asks whether it answers, and leaves it
 * out when it does not. That is no failure: the run stays a success as long as another destination
 * took the backup, and the event of a skipped destination goes out once each time it goes away.
 */

const log = logger.child({ step: "air-gap" });

/** How long the question before an upload waits, like the health check. */
const CHECK_TIMEOUT_MS = 15_000;

/** When each air-gapped destination was last reported as skipped, by its id. */
export const SKIP_STATE_KEY = "airgap.skipped.state";

/** Whether an air-gapped destination answers right now. One that cannot be asked counts as connected, so its upload decides. */
export async function isConnected(dest: Pick<DestinationContext, "adapter" | "configName"> & { config: unknown }): Promise<boolean> {
    try {
        const result = await runConnectivityCheck(dest.adapter, dest.config, { timeoutMs: CHECK_TIMEOUT_MS, label: dest.configName });
        return result === null || result.success;
    } catch {
        return false;
    }
}

function parseState(value: string | undefined): Record<string, string> {
    if (!value) return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
        return {};
    }
}

/** When the destination last answered its health check, null while no check that DBackup keeps did. */
async function lastConnectedAt(configId: string): Promise<Date | null> {
    const check = await prisma.healthCheckLog.findFirst({
        where: { adapterConfigId: configId, status: "ONLINE" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });
    return check?.createdAt ?? null;
}

/**
 * Reports the air-gapped destinations a run left out. The first run that leaves one out sends the
 * event, the runs after it stay quiet until the destination was connected again. A failure here
 * never fails the run.
 */
export async function reportSkippedAirGaps(ctx: RunnerContext, skipped: DestinationContext[]): Promise<void> {
    if (skipped.length === 0) return;
    try {
        const stored = await prisma.systemSetting.findUnique({ where: { key: SKIP_STATE_KEY }, select: { value: true } });
        const state = parseState(stored?.value);
        const { notify } = await import("@/services/notifications/system-notification-service");
        let changed = false;
        for (const dest of skipped) {
            const connected = await lastConnectedAt(dest.configId);
            const reported = state[dest.configId];
            // Reported already and not connected since, so it is still the same time away.
            if (reported && (!connected || connected.getTime() <= Date.parse(reported))) continue;
            const sent = await notify(
                {
                    eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED,
                    data: {
                        storageName: dest.configName,
                        storageId: dest.configId,
                        jobName: ctx.job?.name ?? "A job",
                        jobId: ctx.job?.id,
                        lastConnectedAt: connected?.toISOString(),
                        timestamp: new Date().toISOString(),
                    },
                },
                { executionId: ctx.execution?.id },
            );
            // An event that is off sends nothing, so switching it on reports the next skip.
            if (!sent) continue;
            state[dest.configId] = new Date().toISOString();
            changed = true;
        }
        if (changed) {
            const value = JSON.stringify(state);
            await prisma.systemSetting.upsert({ where: { key: SKIP_STATE_KEY }, update: { value }, create: { key: SKIP_STATE_KEY, value } });
        }
    } catch (error: unknown) {
        log.warn("Reporting a skipped air-gapped destination failed", { executionId: ctx.execution?.id }, wrapError(error));
    }
}
