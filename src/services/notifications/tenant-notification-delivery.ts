/**
 * Delivers an event about the data of a tenant to the channels that tenant picked in its own
 * settings, after the platform heard about it. The channels are read in the tenant, so a channel
 * of another tenant never gets it unless that tenant shares it, and the notification log keeps each
 * send in this tenant, also one through a shared channel. The home tenant hears about its data
 * through the notifications of the platform.
 */

import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { loadNotificationBrand } from "@/lib/notifications/brand";
import { getTenantEventDefinition } from "@/lib/notifications/tenant-events";
import { renderTemplate } from "@/lib/notifications/templates";
import type { NotificationEventData } from "@/lib/notifications/types";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { currentTenantId } from "@/lib/tenant/current";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { sendThroughChannel } from "./channel-send";
import { buildTestData } from "./notification-test-data";
import { tenantReason } from "./notification-reason";
import { getTenantNotificationConfig, tenantEventEnabled } from "./tenant-notification-settings";
import { providedTo } from "@/services/sharing/provided";

const log = logger.child({ service: "TenantNotificationDelivery" });

/** How many channels took a notification and how many did not. */
export interface DeliveryResult {
    succeeded: number;
    failed: number;
}

const idOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** The tenant of a connection, a run or a job the event names, read in every tenant. */
async function tenantOfRecord(model: "adapterConfig" | "execution" | "job", id: string): Promise<string | null> {
    const row = await runAsSystem(() => {
        const select = { select: { tenantId: true }, where: { id } } as const;
        if (model === "adapterConfig") return prisma.adapterConfig.findUnique(select);
        if (model === "execution") return prisma.execution.findUnique(select);
        return prisma.job.findUnique(select);
    });
    return row?.tenantId ?? null;
}

/** The tenant of a run, read in every tenant, null for a run that is gone. */
export function tenantOfRun(executionId: string): Promise<string | null> {
    return tenantOfRecord("execution", executionId);
}

/**
 * The tenant whose records an event is about, the home tenant included, which its links name. Null
 * for none, and for an event of the platform alone. A caller may name it, else the event tells it by
 * what it names: a connection, a destination or a server, a run or a job. Without any of them it is
 * the tenant the code runs for, like a run of a job.
 */
export async function recordTenant(event: NotificationEventData, opts: { tenantId?: string | null; executionId?: string } = {}): Promise<string | null> {
    if (!getTenantEventDefinition(event.eventType)) return null;
    if (opts.tenantId !== undefined) return opts.tenantId;
    const data = event.data as unknown as Record<string, unknown>;
    const connectionId = idOf(data.configId) ?? idOf(data.storageId) ?? idOf(data.sourceId);
    if (connectionId) {
        const tenantId = await tenantOfRecord("adapterConfig", connectionId);
        if (tenantId) return tenantId;
    }
    const executionId = opts.executionId ?? idOf(data.executionId);
    if (executionId) {
        const tenantId = await tenantOfRecord("execution", executionId);
        if (tenantId) return tenantId;
    }
    const jobId = idOf(data.jobId);
    if (jobId) {
        const tenantId = await tenantOfRecord("job", jobId);
        if (tenantId) return tenantId;
    }
    return currentTenantId();
}

/**
 * The tenant an event is about, other than the home tenant, null for none. Only an event a tenant
 * can hear about has one, see `recordTenant`.
 */
export async function eventTenant(event: NotificationEventData, opts: { tenantId?: string | null; executionId?: string } = {}): Promise<string | null> {
    const found = await recordTenant(event, opts);
    return found && found !== HOME_TENANT_ID ? found : null;
}

/**
 * Sends the event to the channels the tenant picked for it, its own or the default ones, while it
 * is on there. Nothing for the home tenant, an event a tenant cannot hear about, or a tenant
 * without a channel for it. Never throws for a channel that does not take it.
 */
export async function deliverToTenant(event: NotificationEventData, tenantId: string, opts: { executionId?: string; test?: boolean; skipChannelIds?: readonly string[] } = {}): Promise<DeliveryResult | undefined> {
    if (tenantId === HOME_TENANT_ID) return undefined;
    const definition = getTenantEventDefinition(event.eventType);
    if (!definition) return undefined;

    const config = await getTenantNotificationConfig(tenantId);
    if (!opts.test && !tenantEventEnabled(definition, config)) return undefined;
    // A channel that heard about it already, like one of the job of the run, gets it once.
    const skipped = new Set(opts.skipChannelIds ?? []);
    const channelIds = (config.events[definition.id]?.channels ?? config.globalChannels).filter((id) => !skipped.has(id));
    if (channelIds.length === 0) return undefined;

    return runAsTenant(tenantId, async () => {
        // Its own channels and those other tenants share with it, which go where it named.
        const shared = (await providedTo(tenantId, { kind: "channel", ids: channelIds })).map((channel) => channel.id);
        const channels = [
            ...(await prisma.adapterConfig.findMany({ where: { id: { in: channelIds }, type: "notification", tenantId } })),
            ...(shared.length > 0 ? await runAsSystem(() => prisma.adapterConfig.findMany({ where: { id: { in: shared }, type: "notification" } })) : []),
        ];
        if (channels.length === 0) return undefined;
        registerAdapters();
        const brand = await loadNotificationBrand();
        // Its links name the tenant, so they open there from any other tenant of the reader.
        const payload = { ...renderTemplate(event, { timeZone: brand.timeZone, tenantId }), reason: tenantReason(definition.name, opts.test === true) };

        let succeeded = 0;
        let failed = 0;
        for (const channel of channels) {
            try {
                await sendThroughChannel(channel, payload, event.eventType, undefined, { executionId: opts.executionId, brand, tenantId });
                succeeded++;
            } catch (error: unknown) {
                log.error("Failed to send a tenant notification through a channel", { channelName: channel.name, eventType: event.eventType, tenantId }, wrapError(error));
                failed++;
            }
        }
        return { succeeded, failed };
    });
}

/**
 * Sends an example of an event of the tenant to where it goes now, also while it is off, and says
 * how many channels took it. Nothing sent is a refusal, never a success.
 */
export async function sendTenantEventTest(tenantId: string, eventId: string): Promise<{ sent: number; failed: number }> {
    if (tenantId === HOME_TENANT_ID) throw new ValidationError("The home tenant reports through the notifications of the platform.", { field: "event" });
    if (!getTenantEventDefinition(eventId)) throw new ValidationError(`Unknown notification event "${eventId}".`, { field: "event" });
    const data = buildTestData(eventId);
    if (!data) throw new ValidationError("There is no example of this event to send.", { field: "event" });

    const result = await deliverToTenant(data, tenantId, { test: true });
    if (!result) throw new ValidationError("It has no channel to go to. Pick one or set the default channels first.", { field: "channels" });
    if (result.succeeded === 0) throw new ValidationError("No channel took the test. The notifications of History say why.", { field: "channels" });
    return { sent: result.succeeded, failed: result.failed };
}
