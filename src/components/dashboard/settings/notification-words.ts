import { Activity, ArrowUpCircle, FileCheck2, HardDrive, LogIn, RotateCcw, Settings2, type LucideIcon } from "lucide-react";
import type { NotificationEventRow } from "@/services/notifications/notification-settings-service";

/** What each kind of event is called beside its name, and its icon. */
export const AREAS: Record<NotificationEventRow["category"], { label: string; icon: LucideIcon }> = {
    auth: { label: "Sign-in", icon: LogIn },
    restore: { label: "Restore", icon: RotateCcw },
    storage: { label: "Storage", icon: HardDrive },
    health: { label: "Health", icon: Activity },
    backup: { label: "Backups", icon: FileCheck2 },
    updates: { label: "Updates", icon: ArrowUpCircle },
    system: { label: "System", icon: Settings2 },
};

/** The intervals a reminder offers, in hours. */
export const REMINDER_CHOICES = [6, 12, 24, 48, 168] as const;

/** "every 6 hours", "every day", "every 7 days". */
export function everyText(hours: number): string {
    if (hours === 24) return "every day";
    if (hours % 24 === 0) return `every ${hours / 24} days`;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
}

/** The reminder of an event as its row says it, "-" for an event without reminders. */
export function reminderText(event: Pick<NotificationEventRow, "supportsReminder" | "reminderHours" | "defaultReminderHours">): string {
    if (!event.supportsReminder) return "-";
    if (event.reminderHours === 0) return "Off";
    const hours = event.reminderHours ?? event.defaultReminderHours;
    return hours ? everyText(hours) : "-";
}

/** The channels an event goes to now: its own, or the default ones. */
export function channelsOf(event: Pick<NotificationEventRow, "channels">, defaults: string[], known: Set<string>): string[] {
    return (event.channels ?? defaults).filter((id) => known.has(id));
}
