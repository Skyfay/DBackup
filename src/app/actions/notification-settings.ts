"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import {
  getNotificationConfig,
  saveNotificationConfig,
  getAvailableChannels,
} from "@/services/system-notification-service";
import { EVENT_DEFINITIONS } from "@/lib/notifications/events";

const log = logger.child({ action: "notification-settings" });

// ── Validation Schemas ─────────────────────────────────────────

const eventSettingSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(z.string()).nullable(),
  notifyUser: z.enum(["none", "also", "only"]).optional(),
});

const configSchema = z.object({
  globalChannels: z.array(z.string()),
  events: z.record(z.string(), eventSettingSchema),
});

// ── Actions ────────────────────────────────────────────────────

/** Load the current notification configuration (channels + events) */
export async function getNotificationSettings() {
  await checkPermission(PERMISSIONS.SETTINGS.READ);

  try {
    const [config, channels] = await Promise.all([
      getNotificationConfig(),
      getAvailableChannels(),
    ]);

    return {
      success: true,
      data: {
        config,
        availableChannels: channels,
        eventDefinitions: EVENT_DEFINITIONS,
      },
    };
  } catch (error: unknown) {
    log.error("Failed to load notification settings", {}, wrapError(error));
    return { success: false, error: "Failed to load notification settings" };
  }
}

/** Save the full notification configuration */
export async function updateNotificationSettings(
  data: z.infer<typeof configSchema>
) {
  await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  const result = configSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.issues[0].message };
  }

  try {
    await saveNotificationConfig(result.data);
    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (error: unknown) {
    log.error("Failed to update notification settings", {}, wrapError(error));
    return { success: false, error: "Failed to update notification settings" };
  }
}

/** Send a test notification through all enabled channels for a given event type */
export async function sendTestNotification(eventType: string) {
  await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  try {
    const eventDef = EVENT_DEFINITIONS.find((e) => e.id === eventType);
    if (!eventDef) {
      return { success: false, error: "Unknown event type" };
    }

    // Dynamically import to avoid circular dependencies
    const { notify } = await import("@/services/system-notification-service");

    // Build a synthetic event with example data
    const testData = buildTestData(eventType);
    if (!testData) {
      return { success: false, error: "No test data available for this event" };
    }

    await notify(testData);

    return { success: true, message: "Test notification sent" };
  } catch (error: unknown) {
    log.error("Failed to send test notification", {}, wrapError(error));
    return { success: false, error: "Failed to send test notification" };
  }
}

// ── Helpers ────────────────────────────────────────────────────

function buildTestData(eventType: string): any {
  const now = new Date().toISOString();

  const testPayloads: Record<string, any> = {
    user_login: {
      eventType: "user_login",
      data: {
        userName: "Test User",
        email: "test@example.com",
        ipAddress: "127.0.0.1",
        timestamp: now,
      },
    },
    user_created: {
      eventType: "user_created",
      data: {
        userName: "New User",
        email: "new@example.com",
        createdBy: "Admin",
        timestamp: now,
      },
    },
    restore_complete: {
      eventType: "restore_complete",
      data: {
        sourceName: "MySQL Production",
        targetDatabase: "app_db_restored",
        duration: 8000,
        timestamp: now,
      },
    },
    restore_failure: {
      eventType: "restore_failure",
      data: {
        sourceName: "MySQL Production",
        targetDatabase: "app_db",
        error: "Permission denied (test)",
        timestamp: now,
      },
    },
    config_backup: {
      eventType: "config_backup",
      data: {
        fileName: "config_backup_test.json.gz.enc",
        size: 4096,
        encrypted: true,
        timestamp: now,
      },
    },
    system_error: {
      eventType: "system_error",
      data: {
        component: "Scheduler",
        error: "This is a test error notification",
        timestamp: now,
      },
    },
    storage_usage_spike: {
      eventType: "storage_usage_spike",
      data: {
        storageName: "Local Storage (Test)",
        previousSize: 1073741824,
        currentSize: 1610612736,
        changePercent: 50,
        timestamp: now,
      },
    },
    storage_limit_warning: {
      eventType: "storage_limit_warning",
      data: {
        storageName: "Local Storage (Test)",
        currentSize: 9663676416,
        limitSize: 10737418240,
        usagePercent: 90,
        timestamp: now,
      },
    },
    storage_missing_backup: {
      eventType: "storage_missing_backup",
      data: {
        storageName: "Local Storage (Test)",
        lastBackupAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        thresholdHours: 48,
        hoursSinceLastBackup: 72,
        timestamp: now,
      },
    },
  };

  return testPayloads[eventType] ?? null;
}
