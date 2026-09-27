import type { NotificationLogFacets, NotificationStats } from "@/services/notifications/notification-log-service";

/** One notification of the log as the History page reads it from `/api/notification-logs`. */
export interface NotificationLogRow {
    id: string;
    eventType: string;
    channelId?: string | null;
    channelName: string;
    adapterId: string;
    status: "Success" | "Failed";
    title: string;
    message: string;
    fields?: string | null;
    color?: string | null;
    renderedHtml?: string | null;
    renderedPayload?: string | null;
    error?: string | null;
    executionId?: string | null;
    sentAt: string;
}

export interface NotificationPage {
    rows: NotificationLogRow[];
    total: number;
    facets?: NotificationLogFacets;
    stats?: NotificationStats;
    options?: { channels: { name: string; adapterId: string }[]; events: string[] };
}

/** The events of DBackup in words, for the rows and the Event filter. */
export const EVENT_LABELS: Record<string, string> = {
    backup_success: "Backup done",
    backup_partial: "Backup partial",
    backup_failure: "Backup failed",
    restore_complete: "Restore done",
    restore_failure: "Restore failed",
    user_login: "User login",
    user_created: "User created",
    config_backup: "Config backup",
    system_error: "System error",
    storage_usage_spike: "Storage spike",
    storage_limit_warning: "Storage limit",
    storage_missing_backup: "Missing backup",
    update_available: "Update available",
    integrity_check_failure: "Integrity check failed",
    connection_offline: "Connection offline",
    connection_online: "Connection online",
    db_version_changed: "Version changed",
};

export function eventLabel(eventType: string): string {
    return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
