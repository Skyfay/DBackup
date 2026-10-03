"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ValidationError, getErrorMessage } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { getDataRetentionValues, updateDataRetentionSettings } from "@/services/system/data-retention-service";
import { retentionChanges, SETTINGS_AREAS } from "@/services/system/settings-audit";
import type { SaveResult } from "@/lib/settings/save-part";

const schema = z.record(z.string().min(1), z.coerce.number().int().min(0));

/** Saves the retention periods of the save bar. Allowed values are checked by the service. */
export async function saveDataRetentionAction(values: Record<string, number>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = schema.safeParse(values);
    if (!parsed.success) {
        return { success: false, error: "Invalid retention setting" };
    }

    try {
        const before = await getDataRetentionValues();
        await updateDataRetentionSettings(parsed.data);
        const changes = retentionChanges(before, await getDataRetentionValues());
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.DATA_RETENTION, changes });
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        return { success: false, error: getErrorMessage(error) };
    }
}
