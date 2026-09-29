"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getErrorMessage } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { getDataRetentionValues, updateDataRetentionSetting } from "@/services/system/data-retention-service";
import { retentionChanges, SETTINGS_AREAS } from "@/services/system/settings-audit";

const schema = z.object({
    id: z.string().min(1),
    days: z.coerce.number().int().min(0),
});

/** Saves one retention period. Allowed values are checked by the service. */
export async function updateDataRetentionSettingAction(input: { id: string; days: number }) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { success: false, error: "Invalid retention setting" };
    }

    try {
        const before = await getDataRetentionValues();
        await updateDataRetentionSetting(parsed.data.id, parsed.data.days);
        const changes = retentionChanges(before, await getDataRetentionValues());
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.DATA_RETENTION, changes });
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}
