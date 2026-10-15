import prisma from "@/lib/prisma";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { TENANT_EVENT_DEFINITIONS } from "@/lib/notifications/tenant-events";
import { runAsSystem } from "@/lib/tenant/context";
import type { TenantNotificationConfig } from "@/services/notifications/tenant-notification-settings";

/**
 * What the audit log keeps of a change of the tenant settings. The entries are about the tenant
 * (`TENANT`) with `area` set to this, so the log leads to the tenant settings rather than to the
 * Tenants page of the platform.
 */
export const TENANT_SETTINGS_AREA = "Tenant settings";

const FIELDS: Record<string, AuditField> = { globalChannels: { label: "Default channels" } };
for (const event of TENANT_EVENT_DEFINITIONS) {
    FIELDS[`${event.id}.enabled`] = { label: event.name };
    FIELDS[`${event.id}.channels`] = { label: `${event.name} channels` };
}

function shown(config: TenantNotificationConfig, names: Map<string, string>): Record<string, AuditValue> {
    const channels = (ids: string[]) => ids.map((id) => names.get(id) ?? "A deleted channel");
    const values: Record<string, AuditValue> = { globalChannels: channels(config.globalChannels) };
    for (const event of TENANT_EVENT_DEFINITIONS) {
        const setting = config.events[event.id];
        values[`${event.id}.enabled`] = setting ? setting.enabled : event.defaultEnabled;
        values[`${event.id}.channels`] = setting?.channels ? channels(setting.channels) : "Default channels";
    }
    return values;
}

/** What a save of the notifications of a tenant changed, with the channels by their names. */
export async function tenantNotificationChanges(before: TenantNotificationConfig, after: TenantNotificationConfig): Promise<AuditChange[]> {
    const ids = [before, after].flatMap((config) => [...config.globalChannels, ...Object.values(config.events).flatMap((event) => event.channels ?? [])]);
    // A deleted channel keeps no name, whatever tenant the code runs in.
    const rows = ids.length === 0 ? [] : await runAsSystem(() => prisma.adapterConfig.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } }));
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return diffFields(shown(before, names), shown(after, names), FIELDS);
}
