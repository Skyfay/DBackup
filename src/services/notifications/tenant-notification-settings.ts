/**
 * The notifications of a tenant: which of its own channels hear about which events of its own
 * data, stored per tenant in `SystemSetting` under `notifications.tenant.<id>`. They work like the
 * Notifications part of the platform, with default channels and channels per event, without the
 * reminders and the mails to a person, which stay the platform's.
 */

import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/prisma-tx";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { connectionOptions } from "@/services/sharing/connection-options";
import { providedTo } from "@/services/sharing/provided";
import { ValidationError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { TENANT_EVENT_DEFINITIONS, getTenantEventDefinition, type TenantEventDefinition } from "@/lib/notifications/tenant-events";
import type { NotificationEventRow, NotificationsModel } from "./notification-settings-service";

const log = logger.child({ service: "TenantNotificationSettings" });

/** What a tenant stored, in the shape of the platform's config. */
export interface TenantNotificationConfig {
    /** The channels every event goes to unless it has its own. */
    globalChannels: string[];
    events: Record<string, { enabled: boolean; /** Its own channels, null for the default ones. */ channels: string[] | null }>;
}

/** What a save changes of one or several events. Left out means as it is. */
export interface TenantEventPatch {
    enabled?: boolean;
    channels?: string[] | null;
}

/** The key of the setting of a tenant. */
export function tenantNotificationKey(tenantId: string): string {
    return `notifications.tenant.${tenantId}`;
}

const emptyConfig = (): TenantNotificationConfig => ({ globalChannels: [], events: {} });

/** The client a read or a save goes through, a transaction for a change that runs in one. */
type SettingsClient = Pick<typeof prisma, "systemSetting"> | Pick<Tx, "systemSetting">;

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/** The stored config of a tenant, the empty one while it saved none or kept something unreadable. */
export async function getTenantNotificationConfig(tenantId: string, client: SettingsClient = prisma): Promise<TenantNotificationConfig> {
    const row = await client.systemSetting.findUnique({ where: { key: tenantNotificationKey(tenantId) }, select: { value: true } });
    if (!row) return emptyConfig();
    try {
        const parsed = JSON.parse(row.value) as Partial<TenantNotificationConfig>;
        const events: TenantNotificationConfig["events"] = {};
        for (const [id, setting] of Object.entries(parsed.events ?? {})) {
            if (!getTenantEventDefinition(id) || typeof setting !== "object" || setting === null) continue;
            events[id] = { enabled: setting.enabled === true, channels: setting.channels === null || setting.channels === undefined ? null : ids(setting.channels) };
        }
        return { globalChannels: ids(parsed.globalChannels), events };
    } catch {
        log.warn("Invalid tenant notification config, using none", { tenantId });
        return emptyConfig();
    }
}

export async function saveTenantNotificationConfig(tenantId: string, config: TenantNotificationConfig, client: SettingsClient = prisma): Promise<void> {
    const value = JSON.stringify(config);
    await client.systemSetting.upsert({
        where: { key: tenantNotificationKey(tenantId) },
        update: { value },
        create: { key: tenantNotificationKey(tenantId), value, description: "The notifications of a tenant (channels & events)" },
    });
}

/** Whether the event sends now: as stored, or as its definition says while nobody set it. */
export function tenantEventEnabled(definition: TenantEventDefinition, config: TenantNotificationConfig): boolean {
    const setting = config.events[definition.id];
    return setting ? setting.enabled : definition.defaultEnabled;
}

/**
 * Whether a tenant other than the home tenant hears about the event on a channel of its own: it is
 * on there and has a channel to go to. Lets a caller skip gathering what the event needs.
 */
export async function tenantHearsAbout(tenantId: string, eventType: string): Promise<boolean> {
    if (tenantId === HOME_TENANT_ID) return false;
    const definition = getTenantEventDefinition(eventType);
    if (!definition) return false;
    const config = await getTenantNotificationConfig(tenantId);
    return tenantEventEnabled(definition, config) && (config.events[definition.id]?.channels ?? config.globalChannels).length > 0;
}

function rowOf(definition: TenantEventDefinition, config: TenantNotificationConfig): NotificationEventRow {
    return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        enabled: tenantEventEnabled(definition, config),
        channels: config.events[definition.id]?.channels ?? null,
        // A person and the reminders are the platform's, so a row of a tenant has neither.
        notifyUser: null,
        supportsReminder: false,
        reminderHours: null,
        defaultReminderHours: null,
    };
}

/** The Notifications part of the tenant settings: its channels, its default ones and every event of its own data. */
export async function getTenantNotificationsModel(tenantId: string): Promise<NotificationsModel> {
    const [config, channels] = await Promise.all([
        getTenantNotificationConfig(tenantId),
        // Its own channels, and those other tenants share with it.
        runAsTenant(tenantId, () => connectionOptions("notification")),
    ]);
    return {
        channels,
        defaultChannels: config.globalChannels.filter((id) => channels.some((channel) => channel.id === id)),
        events: TENANT_EVENT_DEFINITIONS.map((definition) => rowOf(definition, config)),
    };
}

/** Refuses a channel that is no notification connection of the tenant, before anything is stored. */
async function checkChannels(tenantId: string, channelIds: string[]): Promise<void> {
    const unique = [...new Set(channelIds)];
    if (unique.length === 0) return;
    const [found, shared] = await Promise.all([
        runAsTenant(tenantId, () => prisma.adapterConfig.count({ where: { id: { in: unique }, type: "notification", tenantId } })),
        providedTo(tenantId, { kind: "channel", ids: unique }),
    ]);
    if (found + shared.length !== unique.length) throw new ValidationError("A picked channel no longer exists.", { field: "channels" });
}

/**
 * Applies the same change to one or several events of the tenant and saves its config at once.
 * Own channels need at least one, since an empty list would fall back to the default ones.
 */
export async function saveTenantEventSettings(tenantId: string, eventIds: string[], patch: TenantEventPatch): Promise<{ before: TenantNotificationConfig; after: TenantNotificationConfig }> {
    const definitions = eventIds.map((id) => {
        const definition = getTenantEventDefinition(id);
        if (!definition) throw new ValidationError(`Unknown notification event "${id}".`, { field: "event" });
        return definition;
    });
    if (patch.channels && patch.channels.length === 0) {
        throw new ValidationError("Pick at least one channel, or send it to the default channels.", { field: "channels" });
    }
    if (patch.channels) await checkChannels(tenantId, patch.channels);

    const before = await getTenantNotificationConfig(tenantId);
    const events = { ...before.events };
    for (const definition of definitions) {
        const current = events[definition.id] ?? { enabled: definition.defaultEnabled, channels: null };
        events[definition.id] = {
            enabled: patch.enabled ?? current.enabled,
            channels: patch.channels === undefined ? current.channels : patch.channels ? [...new Set(patch.channels)] : null,
        };
    }
    const after: TenantNotificationConfig = { ...before, events };
    await saveTenantNotificationConfig(tenantId, after);
    return { before, after };
}

/** The channels every event of the tenant goes to unless it has its own. None is allowed. */
export async function saveTenantDefaultChannels(tenantId: string, channelIds: string[]): Promise<{ before: TenantNotificationConfig; after: TenantNotificationConfig }> {
    await checkChannels(tenantId, channelIds);
    const before = await getTenantNotificationConfig(tenantId);
    const after: TenantNotificationConfig = { ...before, globalChannels: [...new Set(channelIds)] };
    await saveTenantNotificationConfig(tenantId, after);
    return { before, after };
}
