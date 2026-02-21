/**
 * Notification templates that generate adapter-agnostic payloads.
 *
 * Each template receives typed event data and returns a `NotificationPayload`
 * that adapters (Email, Discord, etc.) render in their native format.
 */

import { formatBytes } from "@/lib/utils";
import {
  NOTIFICATION_EVENTS,
  NotificationEventData,
  NotificationPayload,
  UserLoginData,
  UserCreatedData,
  BackupResultData,
  RestoreResultData,
  ConfigBackupData,
  SystemErrorData,
} from "./types";

// ── Individual Template Functions ──────────────────────────────

function userLoginTemplate(data: UserLoginData): NotificationPayload {
  return {
    title: "User Login",
    message: `${data.userName} (${data.email}) logged in.`,
    fields: [
      { name: "User", value: data.userName, inline: true },
      { name: "Email", value: data.email, inline: true },
      ...(data.ipAddress
        ? [{ name: "IP Address", value: data.ipAddress, inline: true }]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#3b82f6", // blue
    success: true,
  };
}

function userCreatedTemplate(data: UserCreatedData): NotificationPayload {
  return {
    title: "New User Created",
    message: `A new user account was created: ${data.userName} (${data.email}).`,
    fields: [
      { name: "User", value: data.userName, inline: true },
      { name: "Email", value: data.email, inline: true },
      ...(data.createdBy
        ? [{ name: "Created By", value: data.createdBy, inline: true }]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#22c55e", // green
    success: true,
  };
}

function backupSuccessTemplate(data: BackupResultData): NotificationPayload {
  return {
    title: "Backup Successful",
    message: `Backup job '${data.jobName}' completed successfully.`,
    fields: [
      { name: "Job", value: data.jobName, inline: true },
      ...(data.sourceName
        ? [{ name: "Source", value: data.sourceName, inline: true }]
        : []),
      ...(data.duration !== undefined
        ? [
            {
              name: "Duration",
              value: `${Math.round(data.duration / 1000)}s`,
              inline: true,
            },
          ]
        : []),
      ...(data.size !== undefined
        ? [{ name: "Size", value: formatBytes(data.size), inline: true }]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#22c55e", // green
    success: true,
  };
}

function backupFailureTemplate(data: BackupResultData): NotificationPayload {
  return {
    title: "Backup Failed",
    message: `Backup job '${data.jobName}' failed.${data.error ? ` Error: ${data.error}` : ""}`,
    fields: [
      { name: "Job", value: data.jobName, inline: true },
      ...(data.sourceName
        ? [{ name: "Source", value: data.sourceName, inline: true }]
        : []),
      ...(data.error
        ? [{ name: "Error", value: data.error, inline: false }]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#ef4444", // red
    success: false,
  };
}

function restoreCompleteTemplate(
  data: RestoreResultData
): NotificationPayload {
  return {
    title: "Restore Completed",
    message: `Database restore completed successfully.${data.targetDatabase ? ` Target: ${data.targetDatabase}` : ""}`,
    fields: [
      ...(data.sourceName
        ? [{ name: "Source", value: data.sourceName, inline: true }]
        : []),
      ...(data.databaseType
        ? [{ name: "Database Type", value: data.databaseType.toUpperCase(), inline: true }]
        : []),
      ...(data.targetDatabase
        ? [{ name: "Target DB", value: data.targetDatabase, inline: true }]
        : []),
      ...(data.storageName
        ? [{ name: "Storage", value: data.storageName, inline: true }]
        : []),
      ...(data.backupFile
        ? [{ name: "Backup File", value: data.backupFile, inline: false }]
        : []),
      ...(data.size !== undefined
        ? [{ name: "Size", value: formatBytes(data.size), inline: true }]
        : []),
      ...(data.duration !== undefined
        ? [
            {
              name: "Duration",
              value: `${Math.round(data.duration / 1000)}s`,
              inline: true,
            },
          ]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#22c55e", // green
    success: true,
  };
}

function restoreFailureTemplate(
  data: RestoreResultData
): NotificationPayload {
  return {
    title: "Restore Failed",
    message: `Database restore failed.${data.error ? ` Error: ${data.error}` : ""}`,
    fields: [
      ...(data.sourceName
        ? [{ name: "Source", value: data.sourceName, inline: true }]
        : []),
      ...(data.databaseType
        ? [{ name: "Database Type", value: data.databaseType.toUpperCase(), inline: true }]
        : []),
      ...(data.targetDatabase
        ? [{ name: "Target DB", value: data.targetDatabase, inline: true }]
        : []),
      ...(data.backupFile
        ? [{ name: "Backup File", value: data.backupFile, inline: false }]
        : []),
      ...(data.error
        ? [{ name: "Error", value: data.error, inline: false }]
        : []),
      ...(data.duration !== undefined
        ? [
            {
              name: "Duration",
              value: `${Math.round(data.duration / 1000)}s`,
              inline: true,
            },
          ]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#ef4444", // red
    success: false,
  };
}

function configBackupTemplate(data: ConfigBackupData): NotificationPayload {
  return {
    title: "Configuration Backup Created",
    message: `A system configuration backup was created.${data.encrypted ? " (Encrypted)" : ""}`,
    fields: [
      ...(data.fileName
        ? [{ name: "File", value: data.fileName, inline: true }]
        : []),
      ...(data.size !== undefined
        ? [{ name: "Size", value: formatBytes(data.size), inline: true }]
        : []),
      {
        name: "Encrypted",
        value: data.encrypted ? "Yes" : "No",
        inline: true,
      },
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#8b5cf6", // purple
    success: true,
  };
}

function systemErrorTemplate(data: SystemErrorData): NotificationPayload {
  return {
    title: "System Error",
    message: `A system error occurred in ${data.component}: ${data.error}`,
    fields: [
      { name: "Component", value: data.component, inline: true },
      { name: "Error", value: data.error, inline: false },
      ...(data.details
        ? [{ name: "Details", value: data.details, inline: false }]
        : []),
      { name: "Time", value: data.timestamp, inline: true },
    ],
    color: "#ef4444", // red
    success: false,
  };
}

// ── Template Dispatcher ────────────────────────────────────────

/**
 * Generates a NotificationPayload for any event type.
 * Adapters consume this payload and render it in their native format
 * (Discord embeds, email HTML, etc.).
 */
export function renderTemplate(
  event: NotificationEventData
): NotificationPayload {
  switch (event.eventType) {
    case NOTIFICATION_EVENTS.USER_LOGIN:
      return userLoginTemplate(event.data);
    case NOTIFICATION_EVENTS.USER_CREATED:
      return userCreatedTemplate(event.data);
    case NOTIFICATION_EVENTS.BACKUP_SUCCESS:
      return backupSuccessTemplate(event.data);
    case NOTIFICATION_EVENTS.BACKUP_FAILURE:
      return backupFailureTemplate(event.data);
    case NOTIFICATION_EVENTS.RESTORE_COMPLETE:
      return restoreCompleteTemplate(event.data);
    case NOTIFICATION_EVENTS.RESTORE_FAILURE:
      return restoreFailureTemplate(event.data);
    case NOTIFICATION_EVENTS.CONFIG_BACKUP:
      return configBackupTemplate(event.data);
    case NOTIFICATION_EVENTS.SYSTEM_ERROR:
      return systemErrorTemplate(event.data);
    default:
      // Fallback for unknown events
      return {
        title: "Notification",
        message: "An event occurred.",
        success: true,
        color: "#6b7280",
      };
  }
}
