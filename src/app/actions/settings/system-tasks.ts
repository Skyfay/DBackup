"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { isSystemTaskId, SYSTEM_TASKS } from "@/services/system/system-task-definitions";
import { saveSystemTask, startSystemTask } from "@/services/system/system-task-settings";
import { taskChanges, taskName, taskSnapshot } from "@/services/system/system-task-audit";
import { integritySettings, settingsChanges, SETTINGS_AREAS } from "@/services/system/settings-audit";
import type { SaveResult } from "@/lib/settings/save-part";

const log = logger.child({ action: "system-tasks" });

const taskId = z.string().refine(isSystemTaskId, { message: "Unknown system task" });

const taskSchema = z.object({
    enabled: z.boolean().optional(),
    runOnStartup: z.boolean().optional(),
    schedule: z.string().trim().min(1).optional(),
    integrity: z.object({
        scanMode: z.enum(["jobs", "destinations"]),
        skipPassed: z.boolean(),
        maxAgeDays: z.coerce.number().int().min(0).max(3650),
        maxFileSizeMb: z.coerce.number().int().min(0).max(1_000_000),
    }).optional(),
});

/** Saves a task from its Edit dialog, or only its switch from its row. */
export async function saveSystemTaskAction(id: string, input: z.infer<typeof taskSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsedId = taskId.safeParse(id);
    const parsed = taskSchema.safeParse(input);
    if (!parsedId.success || !isSystemTaskId(parsedId.data)) return { success: false, error: "Unknown system task" };
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") };
    const task = parsedId.data;

    try {
        const [before, integrityBefore] = await Promise.all([taskSnapshot(task), integritySettings()]);
        await saveSystemTask(task, parsed.data);
        const after = await taskSnapshot(task);
        // Switching a task on or off alone reads as that, anything else as a change with its values.
        const switchedOnly = parsed.data.enabled !== undefined && parsed.data.schedule === undefined && parsed.data.runOnStartup === undefined;
        const changes = taskChanges(before, after);
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
                task: after.name,
                name: after.name,
                ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
                ...(switchedOnly ? {} : { changes }),
            }, task);
        }
        if (task === SYSTEM_TASKS.INTEGRITY_CHECK && parsed.data.integrity) {
            const integrityChanges = settingsChanges(integrityBefore, await integritySettings());
            if (integrityChanges.length > 0) {
                await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.INTEGRITY, changes: integrityChanges });
            }
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        log.error("Failed to save a system task", { taskId: task }, wrapError(error));
        return { success: false, error: "Failed to save the task" };
    }
}

/** Starts a task by hand and answers at once. The run in History comes back for a task that writes one. */
export async function runSystemTaskAction(id: string): Promise<{ success: boolean; executionId?: string; error?: string }> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsedId = taskId.safeParse(id);
    if (!parsedId.success || !isSystemTaskId(parsedId.data)) return { success: false, error: "Unknown system task" };
    const task = parsedId.data;

    try {
        const started = await startSystemTask(task, user.name ?? "Manual");
        if (!started.started) return { success: false, error: started.reason };
        const name = taskName(task);
        await auditService.log(user.id, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.SYSTEM, { task: name, name }, task);
        revalidatePath("/dashboard/settings");
        return { success: true, ...(started.executionId ? { executionId: started.executionId } : {}) };
    } catch (error: unknown) {
        log.error("Failed to start a system task", { taskId: task }, wrapError(error));
        return { success: false, error: "Failed to start the task" };
    }
}
