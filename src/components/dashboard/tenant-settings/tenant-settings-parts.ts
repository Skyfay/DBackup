import { Bell, ImageIcon, type LucideIcon } from "lucide-react";
import type { SettingEntry } from "@/components/dashboard/settings/settings-index";
import { RECENTLY_DELETED_PART } from "@/components/dashboard/settings/settings-parts";
import type { PartState } from "@/components/dashboard/settings/settings-states";
import type { TenantSettingsModel } from "@/services/tenant/tenant-settings-model";
import { TENANT_EVENT_DEFINITIONS } from "@/lib/notifications/tenant-events";

/**
 * The parts of the tenant settings as plain data: the name and logo of the open tenant, where its
 * own events go and what was deleted in it lately. With more than one tenant they are Settings
 * under Administration.
 */

export type TenantSettingsPartId = "profile" | "tenant-notifications" | "recently-deleted";

export interface TenantSettingsPart {
    id: TenantSettingsPartId;
    label: string;
    description: string;
    icon: LucideIcon;
}

export const TENANT_SETTINGS_PARTS: TenantSettingsPart[] = [
    { id: "profile", label: "Name and logo", icon: ImageIcon, description: "How the tenant shows in DBackup: in the head of the sidebar, in the tenant switcher and on the Tenants page." },
    { id: "tenant-notifications", label: "Notifications", icon: Bell, description: "Which channels of the tenant hear about its own backups, restores, destinations and connections." },
    // The same part as Recently deleted of Settings with one tenant, with the same address.
    { id: RECENTLY_DELETED_PART.id, label: RECENTLY_DELETED_PART.label, icon: RECENTLY_DELETED_PART.icon, description: RECENTLY_DELETED_PART.description },
];

export const TENANT_SETTINGS_PART_IDS = TENANT_SETTINGS_PARTS.map((part) => part.id);

/** The parts under one heading, the name of the tenant. */
export function tenantSettingsGroups(tenantName: string) {
    return [{ label: tenantName, parts: TENANT_SETTINGS_PARTS }];
}

export function tenantPartOf(id: string): TenantSettingsPart {
    return TENANT_SETTINGS_PARTS.find((part) => part.id === id) ?? TENANT_SETTINGS_PARTS[0];
}

/** The part an address opens, none when `?part=` names no part of the tenant settings. */
export function tenantPartFromAddress(part: string | null): TenantSettingsPartId | null {
    return part && TENANT_SETTINGS_PARTS.some((entry) => entry.id === part) ? (part as TenantSettingsPartId) : null;
}

const SETTINGS: SettingEntry<TenantSettingsPartId>[] = [
    { part: "profile", id: "tenant.name", label: "Name", text: "What the tenant is called in the sidebar, the tenant switcher and the lists of the platform." },
    { part: "profile", id: "tenant.logo", label: "Logo", text: "A PNG, JPG, GIF or WebP picture in place of the initials of the tenant." },
    { part: "tenant-notifications", id: "tenant-notifications.events", label: "Default channels", text: "Where every event of the tenant goes unless it has channels of its own." },
];

/** Every setting the search of the tenant settings finds, the events of the tenant included. */
export function tenantSettingsIndex(): SettingEntry<TenantSettingsPartId>[] {
    return [
        ...TENANT_SETTINGS_PARTS.map((part): SettingEntry<TenantSettingsPartId> => ({ part: part.id, id: part.id, label: part.label, text: part.description })),
        ...SETTINGS,
        ...TENANT_EVENT_DEFINITIONS.map((event): SettingEntry<TenantSettingsPartId> => ({ part: "tenant-notifications", id: `event:${event.id}`, label: event.name, text: event.description })),
    ];
}

/** The state beside each part: whether a logo is set, how many channels hear about the tenant, and how much waits in Recently deleted. */
export function tenantPartStates(model: TenantSettingsModel): Partial<Record<TenantSettingsPartId, PartState>> {
    const states: Partial<Record<TenantSettingsPartId, PartState>> = {};
    if (model.tenant.logo) states.profile = { text: "logo set" };
    if (model.trash.rows.length > 0) states["recently-deleted"] = { text: String(model.trash.rows.length) };
    const notifications = model.notifications;
    if (!notifications) {
        states["tenant-notifications"] = { text: "Platform" };
        return states;
    }
    const known = new Set(notifications.channels.map((channel) => channel.id));
    const nowhere = notifications.events.filter((event) => event.enabled && (event.channels ?? notifications.defaultChannels).every((id) => !known.has(id))).length;
    const count = notifications.channels.length;
    states["tenant-notifications"] = count === 0
        ? { text: "No channel", tone: "warning" }
        : nowhere > 0
          ? { text: nowhere === 1 ? "1 goes nowhere" : `${nowhere} go nowhere`, tone: "warning" }
          : { text: count === 1 ? "1 channel" : `${count} channels` };
    return states;
}
