import { diffFields, type AuditField } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { DEFAULT_TASK_CONFIG, systemTaskService } from "./system-task-service";

/** A system task as the audit log names and compares it. */
export interface TaskSnapshot {
    /** The name the Settings page gives the task, its id when it has none. */
    name: string;
    values: { schedule: string | null; runOnStartup: boolean; enabled: boolean };
}

const FIELDS: Record<keyof TaskSnapshot["values"], AuditField> = {
    schedule: { label: "Schedule" },
    runOnStartup: { label: "Run on startup" },
    enabled: { label: "Enabled" },
};

/** The name of a task, as the Settings page shows it. */
export function taskName(taskId: string): string {
    return DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]?.label ?? taskId;
}

/** A task as it is set now, read before and after a change so its entry has both. */
export async function taskSnapshot(taskId: string): Promise<TaskSnapshot> {
    const [schedule, runOnStartup, enabled] = await Promise.all([
        systemTaskService.getTaskConfig(taskId),
        systemTaskService.getTaskRunOnStartup(taskId),
        systemTaskService.getTaskEnabled(taskId),
    ]);
    return { name: taskName(taskId), values: { schedule: schedule ?? null, runOnStartup, enabled } };
}

/** What a change of a task changed. */
export function taskChanges(before: TaskSnapshot, after: TaskSnapshot): AuditChange[] {
    return diffFields(before.values, after.values, FIELDS);
}
