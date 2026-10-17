"use server";

import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { BULK_REQUEST_LIMIT } from "@/lib/core/bulk";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { applyAlertChanges, saveDestinationAlerts } from "@/services/storage/storage-alert-changes";
import { alertChanges } from "@/services/storage/storage-alert-audit";
import { SETTINGS_AREAS } from "@/services/system/settings-audit";

const log = logger.child({ action: "storage-alerts" });

/**
 * The alerts belong to a destination of one tenant, so they change with the right to change its
 * destinations, in that tenant. All tenants changes no tenant.
 */
const OPEN_A_TENANT = "Open the tenant of the destination to change its alerts.";

const inTenant = (viewer: Viewer) => !viewer.allTenants && Boolean(viewer.tenantId);

// ── Validation Schema ──────────────────────────────────────────

const configIdSchema = z.string().min(1).max(200);

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
  configIds: z.array(configIdSchema).min(1).max(BULK_REQUEST_LIMIT),
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
  const user = await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);
  if (!inTenant(user)) return { success: false, error: OPEN_A_TENANT };

  const id = configIdSchema.safeParse(configId);
  if (!id.success) return { success: false, error: "Unknown destination" };
  const result = alertConfigSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.issues[0].message };
  }

  try {
    const { name, before } = await saveDestinationAlerts(id.data, result.data);
    const changes = alertChanges(before, result.data);
    if (changes.length > 0) {
      await auditService.log(
        user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.ADAPTER,
        { name, area: SETTINGS_AREAS.STORAGE_ALERTS, changes },
        id.data
      );
    }
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof NotFoundError) return { success: false, error: "This destination does not exist anymore" };
    log.error(
      "Failed to update storage alert settings",
      { configId: id.data },
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
  const user = await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);
  if (!inTenant(user)) return { success: false, error: OPEN_A_TENANT };

  const result = alertChangesSchema.safeParse({ configIds, changes });
  if (!result.success) {
    return { success: false, error: result.error.issues[0].message };
  }

  try {
    const data = await applyAlertChanges(result.data.configIds, result.data.changes);
    await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
      area: SETTINGS_AREAS.STORAGE_ALERTS,
      bulk: true,
      requested: result.data.configIds.length,
      succeeded: data.succeeded.length,
      failed: data.failed.length,
    });
    return { success: true, data };
  } catch (error: unknown) {
    log.error("Failed to update the alerts of several destinations", { count: configIds.length }, wrapError(error));
    return { success: false, error: "Failed to update storage alert settings" };
  }
}
