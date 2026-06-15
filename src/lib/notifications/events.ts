/**
 * Registry of all supported system notification events.
 */

import {
  NotificationEventDefinition,
  NOTIFICATION_EVENTS,
} from "./types";

/** All available notification event definitions */
export const EVENT_DEFINITIONS: NotificationEventDefinition[] = [
  // ── Auth Events ──────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.USER_LOGIN,
    name: "User Login",
    description: "A user logged into the application.",
    category: "auth",
    defaultEnabled: false,
    supportsNotifyUser: true,
  },
  {
    id: NOTIFICATION_EVENTS.USER_CREATED,
    name: "User Created",
    description: "A new user account was created.",
    category: "auth",
    defaultEnabled: false,
    supportsNotifyUser: true,
  },

  // NOTE: Backup success/failure events are NOT listed here because they are
  // configured per-job (Job → Notify tab). The templates in templates.ts are
  // still used by the runner pipeline (04-completion) for per-job notifications.

  // ── Restore Events ───────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
    name: "Restore Completed",
    description: "A database restore was completed successfully.",
    category: "restore",
    defaultEnabled: true,
  },
  {
    id: NOTIFICATION_EVENTS.RESTORE_FAILURE,
    name: "Restore Failed",
    description: "A database restore failed.",
    category: "restore",
    defaultEnabled: true,
  },

  // ── System Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.CONFIG_BACKUP,
    name: "Configuration Backup",
    description: "A system configuration backup was created.",
    category: "system",
    defaultEnabled: false,
  },
  {
    id: NOTIFICATION_EVENTS.SYSTEM_ERROR,
    name: "System Error",
    description: "A critical system error occurred.",
    category: "system",
    defaultEnabled: true,
  },

  // ── Storage Events ───────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
    name: "Storage Usage Spike",
    description: "Storage size changed significantly between snapshots.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
  },
  {
    id: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
    name: "Storage Limit Warning",
    description: "Storage usage is approaching the configured size limit.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
  },
  {
    id: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
    name: "Missing Backup Alert",
    description: "No new backup was created within the expected time window.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
  },

  // ── Update Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
    name: "Update Available",
    description: "A new version of DBackup is available.",
    category: "updates",
    defaultEnabled: true,
    supportsReminder: true,
  },

  // ── Backup Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
    name: "Integrity Check Failed",
    description: "Triggered when a scheduled or manual integrity check finds one or more checksum mismatches.",
    category: "backup",
    defaultEnabled: true,
  },

  // ── Health Check Events ──────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
    name: "Connection Offline",
    description: "A source or destination became unreachable after repeated health checks.",
    category: "health",
    defaultEnabled: true,
    supportsReminder: true,
  },
  {
    id: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
    name: "Connection Recovered",
    description: "A previously offline source or destination is reachable again.",
    category: "health",
    defaultEnabled: true,
  },
  {
    id: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
    name: "Database Version Changed",
    description: "A database server's reported engine version changed between two checks.",
    category: "health",
    defaultEnabled: true,
  },
];

/** Look up an event definition by its type string */
export function getEventDefinition(
  eventType: string
): NotificationEventDefinition | undefined {
  return EVENT_DEFINITIONS.find((e) => e.id === eventType);
}

/** Get all event definitions grouped by category */
export function getEventsByCategory(): Record<
  string,
  NotificationEventDefinition[]
> {
  const grouped: Record<string, NotificationEventDefinition[]> = {};
  for (const event of EVENT_DEFINITIONS) {
    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }
    grouped[event.category].push(event);
  }
  return grouped;
}
