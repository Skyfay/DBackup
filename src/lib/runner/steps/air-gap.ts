import prisma from "@/lib/prisma";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runConnectivityCheck } from "@/lib/transport/adapter-invoke";
import { runAsSystem } from "@/lib/tenant/context";
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

/**
 * When each air-gapped destination was last reported as skipped, by its id and the tenant of the
 * job, see `skipKey`. A destination shared with customers is skipped by the jobs of each of them,
 * and the report of one tenant does not silence the others.
 */
export const SKIP_STATE_KEY = "airgap.skipped.state";

/** The key of the skip state of a destination for a tenant, the bare id while the tenant is unknown. */
export const skipKey = (configId: string, tenantId: string | null | undefined) => (tenantId ? `${configId}@${tenantId}` : configId);

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

/**
 * When the destination last answered its health check, null while no check that DBackup keeps did.
 * Read in the system scope, since the checks of a destination another tenant shares belong to that
 * tenant, and only the time leaves here.
 */
async function lastConnectedAt(configId: string): Promise<Date | null> {
    const check = await runAsSystem(() => prisma.healthCheckLog.findFirst({
        where: { adapterConfigId: configId, status: "ONLINE" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    }));
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
            // The event is about the job, so it goes to the tenant of the job, not to the channels a
            // tenant that shares the destination picked. The channels of the platform hear every
            // event, so with the event on there, a home tenant that shares it reads of the job too.
            const tenantId = ctx.job?.tenantId ?? dest.customer ?? null;
            const key = skipKey(dest.configId, tenantId);
            const connected = await lastConnectedAt(dest.configId);
            // A report of an earlier version is keyed by the destination alone, of a time when every
            // job wrote to destinations of its own tenant only.
            const reported = state[key] ?? (dest.customer ? undefined : state[dest.configId]);
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
                { executionId: ctx.execution?.id, ...(tenantId ? { tenantId } : {}) },
            );
            // An event that is off sends nothing, so switching it on reports the next skip.
            if (!sent) continue;
            if (key !== dest.configId && !dest.customer) delete state[dest.configId];
            state[key] = new Date().toISOString();
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
