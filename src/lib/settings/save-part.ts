import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { settingsChanges, type SettingsSnapshot } from "@/services/system/settings-audit";

const log = logger.child({ action: "settings" });

export type SaveResult = { success: true } | { success: false; error: string; field?: string };

/** The first problem Zod found, with the field it belongs to. */
export function invalid(issues: { message: string; path: PropertyKey[] }[]): SaveResult {
    return { success: false, error: issues[0].message, field: String(issues[0].path[0] ?? "") };
}

/**
 * Saves one part of the Settings page for its Server Action, after the action checked the
 * permission and the input,
 * and writes what changed in the words of the part. A `ValidationError` of the service goes back
 * to the save bar as it is, anything else only to the log.
 */
export async function savePart(
    userId: string,
    area: string,
    read: () => Promise<SettingsSnapshot>,
    save: () => Promise<void>
): Promise<SaveResult> {
    try {
        const before = await read();
        await save();
        const changes = settingsChanges(before, await read());
        if (changes.length > 0) {
            await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area, changes });
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        log.error("Failed to save settings", { area }, wrapError(error));
        return { success: false, error: "Failed to save the settings" };
    }
}
