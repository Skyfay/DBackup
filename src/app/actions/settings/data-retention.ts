"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getErrorMessage } from "@/lib/logging/errors";
import { updateDataRetentionSetting } from "@/services/system/data-retention-service";

const schema = z.object({
    id: z.string().min(1),
    days: z.coerce.number().int().min(0),
});

/** Saves one retention period. Allowed values are checked by the service. */
export async function updateDataRetentionSettingAction(input: { id: string; days: number }) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { success: false, error: "Invalid retention setting" };
    }

    try {
        await updateDataRetentionSetting(parsed.data.id, parsed.data.days);
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}
