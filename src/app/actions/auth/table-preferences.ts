"use server";

import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { TableIdSchema, TablePreferencesSchema, type TablePreferences } from "@/lib/core/table-preferences";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { resetTablePreferences, saveTablePreferences } from "@/services/user/preference-service";

const log = logger.child({ action: "table-preferences" });

/**
 * Saves the column layout the signed-in user picked for one table. Null clears it, so the
 * table shows its defaults again.
 *
 * @no-permission-required - Self-service: the layout belongs to the signed-in user, and nobody can change another user's.
 */
export async function saveTableLayout(tableId: string, preferences: TablePreferences | null) {
    const user = await getCurrentUserWithGroup();
    if (!user) return { success: false, error: "Unauthorized" };

    const id = TableIdSchema.safeParse(tableId);
    const layout = TablePreferencesSchema.nullable().safeParse(preferences);
    if (!id.success || !layout.success) {
        return { success: false, error: "Invalid table layout" };
    }

    try {
        if (layout.data) await saveTablePreferences(user.id, id.data, layout.data);
        else await resetTablePreferences(user.id, id.data);
        return { success: true };
    } catch (error) {
        log.error("Saving a table layout failed", { tableId: id.data }, wrapError(error));
        return { success: false, error: "The layout could not be saved" };
    }
}
