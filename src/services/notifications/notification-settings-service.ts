/**
 * The Notifications part of the Settings page: every system event with where it goes, whom it
 * tells and how often it reminds, the default channels, and Send a test.
 */

import prisma from "@/lib/prisma";
import { getAdapterOptions, type AdapterListItemDTO } from "@/lib/adapters/dto";
import { EVENT_DEFINITIONS, getEventDefinition } from "@/lib/notifications/events";
import type { NotificationEventDefinition, NotifyUserMode, SystemNotificationConfig } from "@/lib/notifications/types";
import { ValidationError } from "@/lib/logging/errors";
import { getNotificationConfig, notify, saveNotificationConfig } from "./system-notification-service";
import { buildTestData } from "./notification-test-data";

/** At most a year between two reminders. */
export const MAX_REMINDER_HOURS = 24 * 365;

export interface NotificationEventRow {
    id: string;
    name: string;
    description: string;
    category: NotificationEventDefinition["category"];
    enabled: boolean;
    /** Its own channels, null while it goes to the default ones. */
    channels: string[] | null;
    /** Whether it tells the user it is about too, null for an event without a user. */
    notifyUser: NotifyUserMode | null;
    supportsReminder: boolean;
    /** Hours between reminders, 0 for none, null for the default of the event. */
    reminderHours: number | null;
    defaultReminderHours: number | null;
}

export interface NotificationsModel {
    channels: AdapterListItemDTO[];
    defaultChannels: string[];
    events: NotificationEventRow[];
}

/** What a save changes of one or several events. Left out means as it is. */
export interface EventPatch {
    enabled?: boolean;
    channels?: string[] | null;
    notifyUser?: NotifyUserMode;
    reminderHours?: number | null;
}

function rowOf(definition: NotificationEventDefinition, config: SystemNotificationConfig): NotificationEventRow {
    const setting = config.events[definition.id];
    return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        // An event nobody set yet sends as its definition says.
        enabled: setting ? setting.enabled : definition.defaultEnabled,
        channels: setting?.channels ?? null,
        notifyUser: definition.supportsNotifyUser ? (setting?.notifyUser ?? "none") : null,
        supportsReminder: definition.supportsReminder === true,
        reminderHours: definition.supportsReminder ? (setting?.reminderIntervalHours ?? null) : null,
        defaultReminderHours: definition.defaultReminderHours ?? null,
    };
}

export async function getNotificationsModel(): Promise<NotificationsModel> {
    const [config, channels] = await Promise.all([getNotificationConfig(), getAdapterOptions("notification")]);
    return {
        channels,
        defaultChannels: config.globalChannels.filter((id) => channels.some((channel) => channel.id === id)),
        events: EVENT_DEFINITIONS.map((definition) => rowOf(definition, config)),
    };
}

/** Refuses a channel that is no notification connection, before anything is stored. */
async function checkChannels(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await prisma.adapterConfig.count({ where: { id: { in: unique }, type: "notification" } });
    if (found !== unique.length) throw new ValidationError("A picked channel no longer exists.", { field: "channels" });
}

/**
 * Applies the same change to one or several events and saves the whole config at once. Own
 * channels need at least one, since an empty list fell back to the default ones without a word.
 */
export async function saveEventSettings(eventIds: string[], patch: EventPatch): Promise<{ before: SystemNotificationConfig; after: SystemNotificationConfig }> {
    const definitions = eventIds.map((id) => {
        const definition = getEventDefinition(id);
        if (!definition) throw new ValidationError(`Unknown notification event "${id}".`, { field: "event" });
        return definition;
    });
    if (patch.channels && patch.channels.length === 0) {
        throw new ValidationError("Pick at least one channel, or send it to the default channels.", { field: "channels" });
    }
    if (patch.channels) await checkChannels(patch.channels);
    if (patch.reminderHours !== undefined && patch.reminderHours !== null && (!Number.isInteger(patch.reminderHours) || patch.reminderHours < 0 || patch.reminderHours > MAX_REMINDER_HOURS)) {
        throw new ValidationError("A reminder is a whole number of hours, at most a year.", { field: "reminderHours" });
    }

    const before = await getNotificationConfig();
    const events = { ...before.events };
    for (const definition of definitions) {
        const current = events[definition.id] ?? { enabled: definition.defaultEnabled, channels: null };
        events[definition.id] = {
            ...current,
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.channels !== undefined ? { channels: patch.channels ? [...new Set(patch.channels)] : null } : {}),
            // Only an event about a user tells that user, and only one with reminders reminds.
            ...(patch.notifyUser !== undefined && definition.supportsNotifyUser ? { notifyUser: patch.notifyUser } : {}),
            ...(patch.reminderHours !== undefined && definition.supportsReminder ? { reminderIntervalHours: patch.reminderHours } : {}),
        };
    }
    const after: SystemNotificationConfig = { ...before, events };
    await saveNotificationConfig(after);
    return { before, after };
}

/** The channels every event goes to unless it has its own. None is allowed, then only events with own channels send. */
export async function saveDefaultChannels(ids: string[]): Promise<{ before: SystemNotificationConfig; after: SystemNotificationConfig }> {
    await checkChannels(ids);
    const before = await getNotificationConfig();
    const after: SystemNotificationConfig = { ...before, globalChannels: [...new Set(ids)] };
    await saveNotificationConfig(after);
    return { before, after };
}

/**
 * Sends an example of the event to where it goes now, also while it is off, and says how many
 * channels took it. Nothing sent is a refusal, never a success.
 */
export async function sendEventTest(eventId: string): Promise<{ sent: number; failed: number }> {
    if (!getEventDefinition(eventId)) throw new ValidationError(`Unknown notification event "${eventId}".`, { field: "event" });
    const data = buildTestData(eventId);
    if (!data) throw new ValidationError("There is no example of this event to send.", { field: "event" });

    const result = await notify(data, { test: true });
    if (!result) throw new ValidationError("It has no channel to go to. Pick one or set the default channels first.", { field: "channels" });
    if (result.succeeded === 0 && result.failed === 0) {
        throw new ValidationError("Nothing was sent. Its channels may be gone, or it tells only the user and has no email channel.", { field: "channels" });
    }
    if (result.succeeded === 0) {
        throw new ValidationError("No channel took the test. The notifications of History say why.", { field: "channels" });
    }
    return { sent: result.succeeded, failed: result.failed };
}
