import prisma from "@/lib/prisma";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { EVENT_DEFINITIONS } from "@/lib/notifications/events";
import type { NotifyUserMode, SystemNotificationConfig } from "@/lib/notifications/types";

/**
 * The notification settings as the audit log compares them: the default channels and, for every
 * event, whether it is on, where it goes, whom it mails and how often it reminds, with the channels
 * by their names.
 */

const NOTIFY_USER: Record<NotifyUserMode, string> = { none: "Off", also: "Admin and user", only: "User only" };

/** "Every 12 hours", "Every 2 days", "Off" or "Default" for the reminder of an event. */
function reminderText(hours: number | null | undefined): string {
    if (hours === null || hours === undefined) return "Default";
    if (hours === 0) return "Off";
    if (hours % 24 === 0 && hours > 24) return `Every ${hours / 24} days`;
    return `Every ${hours} hours`;
}

const FIELDS: Record<string, AuditField> = { globalChannels: { label: "Default channels" } };
for (const event of EVENT_DEFINITIONS) {
    FIELDS[`${event.id}.enabled`] = { label: event.name };
    FIELDS[`${event.id}.channels`] = { label: `${event.name} channels` };
    if (event.supportsNotifyUser) FIELDS[`${event.id}.notifyUser`] = { label: `${event.name} to the user` };
    if (event.supportsReminder) FIELDS[`${event.id}.reminder`] = { label: `${event.name} reminder` };
}

function shown(config: SystemNotificationConfig, names: Map<string, string>): Record<string, AuditValue> {
    const channels = (ids: string[]) => ids.map((id) => names.get(id) ?? "A deleted channel");
    const values: Record<string, AuditValue> = { globalChannels: channels(config.globalChannels) };
    for (const event of EVENT_DEFINITIONS) {
        const setting = config.events[event.id];
        // An event nobody set yet sends as its definition says.
        values[`${event.id}.enabled`] = setting ? setting.enabled : event.defaultEnabled;
        values[`${event.id}.channels`] = setting?.channels ? channels(setting.channels) : "Default channels";
        values[`${event.id}.notifyUser`] = NOTIFY_USER[setting?.notifyUser ?? "none"];
        values[`${event.id}.reminder`] = reminderText(setting?.reminderIntervalHours);
    }
    return values;
}

/** What a save of the notification settings changed. */
export async function notificationSettingsChanges(before: SystemNotificationConfig, after: SystemNotificationConfig): Promise<AuditChange[]> {
    const ids = [before, after].flatMap((config) => [...config.globalChannels, ...Object.values(config.events).flatMap((event) => event.channels ?? [])]);
    const rows = ids.length === 0 ? [] : await prisma.adapterConfig.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return diffFields(shown(before, names), shown(after, names), FIELDS);
}
