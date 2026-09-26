"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { saveAlertConfig } from "@/services/storage/storage-alert-service";
import { applyAlertChanges } from "@/services/storage/storage-alert-changes";

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

/** The alerts of the bulk dialog: each off, or on with its value. Left out, one stays as each destination has it. */
const alertChangesSchema = z.object({
  configIds: z.array(z.string().min(1)).min(1).max(BULK_REQUEST_LIMIT),
  changes: z
    .object({
      usageSpike: z
        .object({ enabled: z.boolean(), percent: z.coerce.number().min(1).max(1000).optional() })
        .refine((entry) => !entry.enabled || entry.percent !== undefined, "Turning the usage spike alert on needs a percentage")
        .optional(),
      storageLimit: z
        .object({ enabled: z.boolean(), bytes: z.coerce.number().min(1).optional() })
        .refine((entry) => !entry.enabled || entry.bytes !== undefined, "Turning the storage limit alert on needs a size")
        .optional(),
      missingBackup: z
        .object({ enabled: z.boolean(), hours: z.coerce.number().min(1).max(8760).optional() })
        .refine((entry) => !entry.enabled || entry.hours !== undefined, "Turning the missing backup alert on needs hours")
        .optional(),
    })
    .refine((changes) => Object.values(changes).some(Boolean), "Nothing to change"),
});

// ── Actions ────────────────────────────────────────────────────

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

/** Changes the alerts of several destinations at once. Only the alerts that were set change. */
export async function updateStorageAlertsOfMany(configIds: string[], changes: z.input<typeof alertChangesSchema>["changes"]) {
  await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  const result = alertChangesSchema.safeParse({ configIds, changes });
  if (!result.success) {
    return { success: false, error: result.error.issues[0].message };
  }

  try {
    return { success: true, data: await applyAlertChanges(result.data.configIds, result.data.changes) };
  } catch (error: unknown) {
    log.error("Failed to update the alerts of several destinations", { count: configIds.length }, wrapError(error));
    return { success: false, error: "Failed to update storage alert settings" };
  }
}
