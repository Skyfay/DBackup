"use server";

import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { PageIdSchema, TableIdSchema, TablePreferencesSchema, ViewModeSchema, type TablePreferences, type ViewMode } from "@/lib/core/table-preferences";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { resetTablePreferences, saveTablePreferences, saveViewMode } from "@/services/user/preference-service";

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

/**
 * Saves how the signed-in user wants a list page shown: as a table, as cards or split.
 *
 * @no-permission-required - Self-service: the view belongs to the signed-in user, and nobody can change another user's.
 */
export async function saveViewLayout(pageId: string, view: ViewMode) {
    const user = await getCurrentUserWithGroup();
    if (!user) return { success: false, error: "Unauthorized" };

    const page = PageIdSchema.safeParse(pageId);
    const mode = ViewModeSchema.safeParse(view);
    if (!page.success || !mode.success) {
        return { success: false, error: "Invalid view" };
    }

    try {
        await saveViewMode(user.id, page.data, mode.data);
        return { success: true };
    } catch (error) {
        log.error("Saving a view failed", { pageId: page.data }, wrapError(error));
        return { success: false, error: "The view could not be saved" };
    }
}
