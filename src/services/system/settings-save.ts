import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { AuthContext } from "@/lib/auth/access-control";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService, type AuditOrigin } from "@/services/audit-service";
import { settingsChanges, type SettingsSnapshot } from "@/services/system/settings-audit";

const log = logger.child({ action: "settings" });

export type SaveResult = { success: true } | { success: false; error: string; field?: string };

/**
 * Where the audit entry of a change of the platform goes: the log of the home tenant, whichever
 * tenant the admin has open, so a customer never reads it and the home tenant never misses it.
 */
export const PLATFORM_LOG: AuditOrigin = { tenantId: HOME_TENANT_ID };

/** `PLATFORM_LOG` for an API route, naming the API key of the request like `auditService.logFor`. */
export function platformLogFor(ctx: Pick<AuthContext, "authMethod" | "apiKeyId">): AuditOrigin {
    return { ...PLATFORM_LOG, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null };
}

/** The first problem Zod found, with the field it belongs to. */
export function invalid(issues: { message: string; path: PropertyKey[] }[]): SaveResult {
    return { success: false, error: issues[0].message, field: String(issues[0].path[0] ?? "") };
}

/**
 * Saves one part of the Settings page for its Server Action, after the action checked the
 * permission and the input, and writes what changed in the words of the part into the log of the
 * platform. The parts point only at records of the home tenant, so their snapshots read there. A
 * `ValidationError` of the service goes back to the save bar as it is, anything else only to the
 * log. The action revalidates the page once it succeeded.
 */
export async function savePart(
    userId: string,
    area: string,
    read: () => Promise<SettingsSnapshot>,
    save: () => Promise<void>
): Promise<SaveResult> {
    const snapshot = () => runAsTenant(HOME_TENANT_ID, read);
    try {
        const before = await snapshot();
        await save();
        const changes = settingsChanges(before, await snapshot());
        if (changes.length > 0) {
            await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area, changes }, undefined, PLATFORM_LOG);
        }
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        log.error("Failed to save settings", { area }, wrapError(error));
        return { success: false, error: "Failed to save the settings" };
    }
}
