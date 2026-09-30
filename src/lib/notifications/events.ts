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
    name: "Someone signs in",
    description: "A user signed in to DBackup.",
    category: "auth",
    defaultEnabled: false,
    supportsNotifyUser: true,
  },
  {
    id: NOTIFICATION_EVENTS.USER_CREATED,
    name: "A user is created",
    description: "A new account was made.",
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
    name: "A restore finished",
    description: "A database came back from a backup.",
    category: "restore",
    defaultEnabled: true,
  },
  {
    id: NOTIFICATION_EVENTS.RESTORE_FAILURE,
    name: "A restore failed",
    description: "A restore stopped with an error.",
    category: "restore",
    defaultEnabled: true,
  },

  // ── System Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.CONFIG_BACKUP,
    name: "The configuration was backed up",
    description: "A configuration backup was made.",
    category: "system",
    defaultEnabled: false,
  },
  {
    id: NOTIFICATION_EVENTS.SYSTEM_ERROR,
    name: "A system task failed",
    description: "A system task stopped with an error, like the configuration backup.",
    category: "system",
    defaultEnabled: true,
  },

  // ── Storage Events ───────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
    name: "Storage grows fast",
    description: "The size of a destination changed a lot between two measurements.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
    defaultReminderHours: 24,
  },
  {
    id: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
    name: "Storage nearly full",
    description: "A destination nears the size limit of its alert.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
    defaultReminderHours: 24,
  },
  {
    id: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
    name: "A backup is missing",
    description: "A destination got nothing new within the time of its alert.",
    category: "storage",
    defaultEnabled: true,
    supportsReminder: true,
    defaultReminderHours: 24,
  },

  // ── Update Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
    name: "A new version is out",
    description: "DBackup found a newer version.",
    category: "updates",
    defaultEnabled: true,
    supportsReminder: true,
    defaultReminderHours: 168,
  },

  // ── Backup Events ────────────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
    name: "An integrity check failed",
    description: "A backup no longer matches the checksum saved with it.",
    category: "backup",
    defaultEnabled: true,
  },

  // ── Health Check Events ──────────────────────────────────────
  {
    id: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
    name: "A connection is offline",
    description: "A source or destination stopped answering its health checks.",
    category: "health",
    defaultEnabled: true,
    supportsReminder: true,
    defaultReminderHours: 24,
  },
  {
    id: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
    name: "A connection is back",
    description: "An offline source or destination answers again.",
    category: "health",
    defaultEnabled: true,
  },
  {
    id: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
    name: "A database version changed",
    description: "A server reports another version than at its last check.",
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
