"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as retentionPolicyService from "@/services/templates/retention-policy-service";
import * as namingTemplateService from "@/services/templates/naming-template-service";
import * as schedulePresetService from "@/services/templates/schedule-preset-service";
import * as notificationTemplateService from "@/services/templates/notification-template-service";
import * as excludePatternPresetService from "@/services/templates/exclude-pattern-preset-service";
import { auditService } from "@/services/audit-service";
import { templateNames, type TemplateType } from "@/services/templates/template-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { scheduler } from "@/lib/server/scheduler";
import type { BulkResult } from "@/lib/core/bulk";

/**
 * Bulk deletion for the five template kinds.
 *
 * A separate file from `templates.ts` deliberately: that one is already well past the
 * size a file should reach, and five more actions would push it further. Every entry point
 * here carries its own permission check, which is what the permissions audit walks for.
 */

const log = logger.child({ action: "templates-bulk" });

const TEMPLATE_PATHS = ["/dashboard/templates", "/dashboard/jobs", "/dashboard/connections"];

/**
 * Shared body for the five actions below.
 *
 * Not exported, because a `"use server"` module may only export async functions that are
 * themselves valid Server Actions.
 */
async function runTemplateBulkDelete(
    templateType: TemplateType,
    ids: string[],
    deleteMany: (ids: string[]) => Promise<BulkResult>
) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false as const, error: "Unauthorized" };

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        // Read first, the templates are gone afterwards.
        const names = await templateNames(templateType, parsed.data);
        const result = await deleteMany(parsed.data);

        if (session.user) {
            await auditService.log(
                session.user.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.TEMPLATE,
                {
                    type: templateType,
                    bulk: true,
                    requested: parsed.data.length,
                    succeeded: result.succeeded.length,
                    failed: result.failed.length,
                    names: result.succeeded.flatMap((id) => names.get(id) ?? []),
                }
            );
        }

        for (const path of TEMPLATE_PATHS) revalidatePath(path);

        return { success: true as const, data: result };
    } catch (e: unknown) {
        return { success: false as const, error: getErrorMessage(e) };
    }
}

export async function bulkDeleteRetentionPolicies(ids: string[]) {
    await checkPermission(PERMISSIONS.TEMPLATES.WRITE);
    return runTemplateBulkDelete("RetentionPolicy", ids, retentionPolicyService.deleteRetentionPolicyMany);
}

export async function bulkDeleteNamingTemplates(ids: string[]) {
    await checkPermission(PERMISSIONS.TEMPLATES.WRITE);
    return runTemplateBulkDelete("NamingTemplate", ids, namingTemplateService.deleteNamingTemplateMany);
}

export async function bulkDeleteSchedulePresets(ids: string[]) {
    await checkPermission(PERMISSIONS.TEMPLATES.WRITE);
    const result = await runTemplateBulkDelete("SchedulePreset", ids, schedulePresetService.deleteSchedulePresetMany);
    // The jobs that followed a deleted preset run on the copy of its schedule they got now.
    if (result.success && result.data.succeeded.length > 0) {
        scheduler.refresh().catch((error: unknown) => log.error("Scheduler refresh failed after deleting presets", {}, wrapError(error)));
    }
    return result;
}

export async function bulkDeleteNotificationTemplates(ids: string[]) {
    await checkPermission(PERMISSIONS.TEMPLATES.WRITE);
    return runTemplateBulkDelete("NotificationTemplate", ids, notificationTemplateService.deleteNotificationTemplateMany);
}

export async function bulkDeleteExcludePatternPresets(ids: string[]) {
    await checkPermission(PERMISSIONS.TEMPLATES.WRITE);
    return runTemplateBulkDelete("ExcludePatternPreset", ids, excludePatternPresetService.deleteExcludePatternPresetMany);
}
