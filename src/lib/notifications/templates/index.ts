/**
 * Notification templates that generate adapter-agnostic payloads.
 *
 * Each template receives typed event data and returns a `NotificationPayload`. Chat channels
 * read its title, message and fields, a mail also reads what the payload adds beyond them, like
 * the tiles, the problem and the buttons.
 */

import { NOTIFICATION_EVENTS, NotificationEventData, NotificationPayload, TemplateOptions } from "../types";
import { backupFailureTemplate, backupPartialTemplate, backupSuccessTemplate } from "./backup";
import { configBackupTemplate, restoreCompleteTemplate, restoreFailureTemplate } from "./restore";
import { airGapSkippedTemplate, storageLimitWarningTemplate, storageMissingBackupTemplate, storageUsageSpikeTemplate } from "./storage";
import {
    connectionOfflineTemplate,
    connectionOnlineTemplate,
    dbVersionChangedTemplate,
    integrityCheckFailureTemplate,
    systemErrorTemplate,
    updateAvailableTemplate,
} from "./system";
import { userCreatedTemplate, userLoginTemplate } from "./people";

export { smtpTestTemplate } from "./people";

/**
 * Generates a NotificationPayload for any event type.
 * Adapters consume this payload and render it in their native format
 * (Discord embeds, email HTML, etc.).
 */
export function renderTemplate(event: NotificationEventData, options?: TemplateOptions): NotificationPayload {
    switch (event.eventType) {
        case NOTIFICATION_EVENTS.USER_LOGIN:
            return userLoginTemplate(event.data, options);
        case NOTIFICATION_EVENTS.USER_CREATED:
            return userCreatedTemplate(event.data, options);
        case NOTIFICATION_EVENTS.BACKUP_SUCCESS:
            return backupSuccessTemplate(event.data, options);
        case NOTIFICATION_EVENTS.BACKUP_PARTIAL:
            return backupPartialTemplate(event.data, options);
        case NOTIFICATION_EVENTS.BACKUP_FAILURE:
            return backupFailureTemplate(event.data, options);
        case NOTIFICATION_EVENTS.RESTORE_COMPLETE:
            return restoreCompleteTemplate(event.data, options);
        case NOTIFICATION_EVENTS.RESTORE_FAILURE:
            return restoreFailureTemplate(event.data, options);
        case NOTIFICATION_EVENTS.CONFIG_BACKUP:
            return configBackupTemplate(event.data, options);
        case NOTIFICATION_EVENTS.SYSTEM_ERROR:
            return systemErrorTemplate(event.data, options);
        case NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE:
            return storageUsageSpikeTemplate(event.data, options);
        case NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING:
            return storageLimitWarningTemplate(event.data, options);
        case NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP:
            return storageMissingBackupTemplate(event.data, options);
        case NOTIFICATION_EVENTS.AIRGAP_SKIPPED:
            return airGapSkippedTemplate(event.data, options);
        case NOTIFICATION_EVENTS.UPDATE_AVAILABLE:
            return updateAvailableTemplate(event.data, options);
        case NOTIFICATION_EVENTS.CONNECTION_OFFLINE:
            return connectionOfflineTemplate(event.data, options);
        case NOTIFICATION_EVENTS.CONNECTION_ONLINE:
            return connectionOnlineTemplate(event.data, options);
        case NOTIFICATION_EVENTS.DB_VERSION_CHANGED:
            return dbVersionChangedTemplate(event.data, options);
        case NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE:
            return integrityCheckFailureTemplate(event.data);
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
