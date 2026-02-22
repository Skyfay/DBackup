"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import {
  getAlertConfig,
  saveAlertConfig,
} from "@/services/storage-alert-service";

const log = logger.child({ action: "storage-alerts" });

// ── Validation Schema ──────────────────────────────────────────

const alertConfigSchema = z.object({
  usageSpikeEnabled: z.boolean(),
  usageSpikeThresholdPercent: z.coerce.number().min(1).max(1000),
  storageLimitEnabled: z.boolean(),
  storageLimitBytes: z.coerce.number().min(0),
  missingBackupEnabled: z.boolean(),
  missingBackupHours: z.coerce.number().min(1).max(8760),
});

// ── Actions ────────────────────────────────────────────────────

/** Load storage alert configuration for a specific destination */
export async function getStorageAlertSettings(configId: string) {
  await checkPermission(PERMISSIONS.STORAGE.READ);

  try {
    const config = await getAlertConfig(configId);
    return { success: true, data: config };
  } catch (error: unknown) {
    log.error(
      "Failed to load storage alert settings",
      { configId },
      wrapError(error)
    );
    return { success: false, error: "Failed to load storage alert settings" };
  }
}

/** Save storage alert configuration for a specific destination */
export async function updateStorageAlertSettings(
  configId: string,
  data: z.infer<typeof alertConfigSchema>
) {
  await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  const result = alertConfigSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.issues[0].message };
  }

  try {
    await saveAlertConfig(configId, result.data);
    return { success: true };
  } catch (error: unknown) {
    log.error(
      "Failed to update storage alert settings",
      { configId },
      wrapError(error)
    );
    return {
      success: false,
      error: "Failed to update storage alert settings",
    };
  }
}
