import prisma from "@/lib/prisma";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { findExcludeGroup, parseJsonStringArray } from "@/lib/exclude-groups";

/**
 * A template as the audit log names and compares it: read before and after a change, so the entry
 * of an update holds what changed in the words of the Templates page.
 */

/** The kinds of template, as the entries name them in `type`. */
export type TemplateType = "RetentionPolicy" | "NamingTemplate" | "SchedulePreset" | "NotificationTemplate" | "ExcludePatternPreset";

export interface TemplateSnapshot {
    name: string;
    values: Record<string, AuditValue>;
}

const DESCRIPTION = { description: { label: "Description" } };
const DEFAULT = { isDefault: { label: "Default" } };

const FIELDS: Record<TemplateType, Record<string, AuditField>> = {
    RetentionPolicy: {
        ...DESCRIPTION,
        keeps: { label: "Keeps" },
        keepCount: { label: "Last backups kept" },
        hourly: { label: "Hourly" },
        daily: { label: "Daily" },
        weekly: { label: "Weekly" },
        monthly: { label: "Monthly" },
        yearly: { label: "Yearly" },
        ...DEFAULT,
    },
    NamingTemplate: { ...DESCRIPTION, pattern: { label: "Pattern" }, ...DEFAULT },
    SchedulePreset: { ...DESCRIPTION, schedule: { label: "Schedule" } },
    NotificationTemplate: { ...DESCRIPTION, channels: { label: "Channels" }, ...DEFAULT },
    ExcludePatternPreset: {
        ...DESCRIPTION,
        patterns: { label: "Patterns" },
        groups: { label: "Groups" },
        excludedGroupPatterns: { label: "Left out of the groups" },
        ...DEFAULT,
    },
};

/** How a policy keeps backups, in the words of the policy dialog. */
const KEEPS: Record<RetentionConfiguration["mode"], string> = { NONE: "Everything", SIMPLE: "The last few", SMART: "Smart rotation" };

/** A tier kept at 0 is off, which reads as nothing. */
const tier = (count: number | undefined) => (count && count > 0 ? count : null);

function retentionValues(config: string): Record<string, AuditValue> {
    let parsed: RetentionConfiguration;
    try {
        parsed = JSON.parse(config) as RetentionConfiguration;
    } catch {
        // A policy that cannot be read keeps everything, like the retention step does.
        parsed = { mode: "NONE" };
    }
    const smart = parsed.mode === "SMART" ? parsed.smart : undefined;
    return {
        keeps: KEEPS[parsed.mode] ?? parsed.mode,
        keepCount: parsed.mode === "SIMPLE" ? parsed.simple?.keepCount ?? null : null,
        hourly: tier(smart?.hourly),
        daily: tier(smart?.daily),
        weekly: tier(smart?.weekly),
        monthly: tier(smart?.monthly),
        yearly: tier(smart?.yearly),
    };
}

/** "Slack (success, failed)" for a channel of a notification template. */
const channelText = (channel: { events: string; config: { name: string } }) =>
    `${channel.config.name} (${channel.events.split("|").filter(Boolean).map((event) => event.toLowerCase()).join(", ")})`;

/** A template as it is now, null when there is none with this id. */
export async function templateSnapshot(type: TemplateType, id: string): Promise<TemplateSnapshot | null> {
    switch (type) {
        case "RetentionPolicy": {
            const row = await prisma.retentionPolicy.findUnique({ where: { id } });
            return row && { name: row.name, values: { description: row.description, isDefault: row.isDefault, ...retentionValues(row.config) } };
        }
        case "NamingTemplate": {
            const row = await prisma.namingTemplate.findUnique({ where: { id } });
            return row && { name: row.name, values: { description: row.description, pattern: row.pattern, isDefault: row.isDefault } };
        }
        case "SchedulePreset": {
            const row = await prisma.schedulePreset.findUnique({ where: { id } });
            return row && { name: row.name, values: { description: row.description, schedule: row.schedule } };
        }
        case "NotificationTemplate": {
            const row = await prisma.notificationTemplate.findUnique({
                where: { id },
                include: { channels: { include: { config: { select: { name: true } } } } },
            });
            return row && { name: row.name, values: { description: row.description, channels: row.channels.map(channelText), isDefault: row.isDefault } };
        }
        case "ExcludePatternPreset": {
            const row = await prisma.excludePatternPreset.findUnique({ where: { id } });
            return row && {
                name: row.name,
                values: {
                    description: row.description,
                    patterns: parseJsonStringArray(row.patterns),
                    groups: parseJsonStringArray(row.groups).map((group) => findExcludeGroup(group)?.label ?? group),
                    excludedGroupPatterns: parseJsonStringArray(row.excludedGroupPatterns),
                    isDefault: row.isDefault,
                },
            };
        }
    }
}

/** The details of the entry of a changed template: its name, the name it had before and what changed. */
export function templateUpdate(type: TemplateType, before: TemplateSnapshot | null, after: TemplateSnapshot | null): Record<string, unknown> {
    const name = after?.name ?? before?.name;
    const changes: AuditChange[] = before && after ? diffFields(before.values, after.values, FIELDS[type]) : [];
    return {
        type,
        ...(name ? { name } : {}),
        ...(before && after && before.name !== after.name ? { renamedFrom: before.name } : {}),
        changes,
    };
}

/** The names of the templates of one kind among these ids, read before they are deleted. */
export async function templateNames(type: TemplateType, ids: string[]): Promise<Map<string, string>> {
    const where = { where: { id: { in: ids } }, select: { id: true, name: true } } as const;
    const rows = await (type === "RetentionPolicy" ? prisma.retentionPolicy.findMany(where)
        : type === "NamingTemplate" ? prisma.namingTemplate.findMany(where)
        : type === "SchedulePreset" ? prisma.schedulePreset.findMany(where)
        : type === "NotificationTemplate" ? prisma.notificationTemplate.findMany(where)
        : prisma.excludePatternPreset.findMany(where));
    return new Map(rows.map((row) => [row.id, row.name]));
}

/** The notification template that is the default now, which clearing the default affects. */
export async function defaultNotificationTemplate(): Promise<{ id: string; name: string } | null> {
    return prisma.notificationTemplate.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });
}
