/**
 * The System tasks part of the Settings page: every task with its schedule, its last run and what
 * it follows, and saving one from its Edit dialog or from the switch of its row.
 */

import prisma from "@/lib/prisma";
import { nextRunTimes } from "@/lib/core/cron";
import { isDatabaseMaintenanceActive } from "@/lib/server/database-maintenance";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { DEFAULT_TASK_CONFIG, SYSTEM_TASKS, TASK_ORDER, type SystemTaskId, type TaskFollows } from "./system-task-definitions";
import { systemTaskService, type TaskRunRecord } from "./system-task-service";

const log = logger.child({ service: "SystemTaskSettings" });

export interface SystemTaskRow {
    id: SystemTaskId;
    name: string;
    description: string;
    schedule: string;
    enabled: boolean;
    runOnStartup: boolean;
    running: boolean;
    lastRun: TaskRunRecord | null;
    /** The next start on the schedule, none while it is off. */
    nextRunAt: string | null;
    /** The setting of another part that switches it on and off. */
    follows: TaskFollows | null;
}

/** What the integrity check looks at, set in its Edit dialog. */
export interface IntegritySettings {
    scanMode: "jobs" | "destinations";
    skipPassed: boolean;
    /** Only backups newer than this, 0 for all. */
    maxAgeDays: number;
    /** Skips files larger than this, 0 for none. */
    maxFileSizeMb: number;
}

export interface SystemTaskInput {
    enabled: boolean;
    runOnStartup: boolean;
    schedule: string;
    /** Only for the integrity check. */
    integrity?: IntegritySettings;
}

const INTEGRITY_KEYS = {
    scanMode: "integrity.scanMode",
    skipPassed: "integrity.skipPassed",
    maxAgeDays: "integrity.maxAgeDays",
    maxFileSizeMb: "integrity.maxFileSizeMb",
} as const;

async function row(taskId: SystemTaskId, timezone: string): Promise<SystemTaskRow> {
    const definition = DEFAULT_TASK_CONFIG[taskId];
    const [schedule, enabled, runOnStartup, lastRun] = await Promise.all([
        systemTaskService.getTaskConfig(taskId),
        systemTaskService.getTaskEnabled(taskId),
        systemTaskService.getTaskRunOnStartup(taskId),
        systemTaskService.getTaskLastRun(taskId),
    ]);
    const cron = schedule || definition.interval;
    const next = enabled ? nextRunTimes(cron, timezone, 1)[0] : undefined;
    return {
        id: taskId,
        name: definition.label,
        description: definition.description,
        schedule: cron,
        enabled,
        runOnStartup,
        running: systemTaskService.isRunning(taskId),
        lastRun,
        nextRunAt: next ? next.toISOString() : null,
        follows: definition.follows ?? null,
    };
}

/** Every task in the order of the Settings page. */
export async function getSystemTaskRows(timezone: string): Promise<SystemTaskRow[]> {
    return Promise.all(TASK_ORDER.map((taskId) => row(taskId, timezone)));
}

export async function getIntegritySettings(): Promise<IntegritySettings> {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(INTEGRITY_KEYS) } }, select: { key: true, value: true } });
    const stored = new Map(rows.map((entry) => [entry.key, entry.value]));
    const whole = (key: string) => {
        const value = Number.parseInt(stored.get(key) ?? "", 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return {
        scanMode: stored.get(INTEGRITY_KEYS.scanMode) === "destinations" ? "destinations" : "jobs",
        skipPassed: stored.get(INTEGRITY_KEYS.skipPassed) === "true",
        maxAgeDays: whole(INTEGRITY_KEYS.maxAgeDays),
        maxFileSizeMb: whole(INTEGRITY_KEYS.maxFileSizeMb),
    };
}

async function saveIntegritySettings(settings: IntegritySettings) {
    const values: Record<keyof IntegritySettings, string> = {
        scanMode: settings.scanMode,
        skipPassed: String(settings.skipPassed),
        maxAgeDays: String(settings.maxAgeDays),
        maxFileSizeMb: String(settings.maxFileSizeMb),
    };
    await prisma.$transaction(
        (Object.keys(INTEGRITY_KEYS) as (keyof IntegritySettings)[]).map((field) =>
            prisma.systemSetting.upsert({
                where: { key: INTEGRITY_KEYS[field] },
                update: { value: values[field] },
                create: { key: INTEGRITY_KEYS[field], value: values[field] },
            })
        )
    );
}

/** The configuration backup runs to its destination, so it cannot be switched on without one. */
async function needsDestination(taskId: SystemTaskId, enabled: boolean) {
    if (taskId !== SYSTEM_TASKS.CONFIG_BACKUP || !enabled) return;
    const destination = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" } });
    if (!destination?.value) {
        throw new ValidationError("Pick a destination under Configuration backup first.", { field: "enabled" });
    }
}

function refreshScheduler() {
    import("@/lib/server/scheduler")
        .then(({ scheduler }) => scheduler.refresh())
        .catch((e: unknown) => log.error("Scheduler refresh failed after a system task changed", {}, wrapError(e)));
}

/**
 * Saves what is given of a task, all of it from its Edit dialog, the switch alone from its row. A
 * schedule the scheduler cannot read is refused before anything is written.
 */
export async function saveSystemTask(taskId: SystemTaskId, input: Partial<SystemTaskInput>): Promise<void> {
    if (input.enabled !== undefined) await needsDestination(taskId, input.enabled);
    if (input.schedule !== undefined) await systemTaskService.setTaskConfig(taskId, input.schedule);
    if (input.runOnStartup !== undefined) await systemTaskService.setTaskRunOnStartup(taskId, input.runOnStartup);
    if (input.enabled !== undefined) await systemTaskService.setTaskEnabled(taskId, input.enabled);
    if (taskId === SYSTEM_TASKS.INTEGRITY_CHECK && input.integrity) await saveIntegritySettings(input.integrity);
    refreshScheduler();
}

export type TaskStart = { started: true; executionId?: string } | { started: false; reason: string };

/**
 * Starts a task by hand without waiting for it to end, so Run now answers at once. The integrity
 * check hands back its run in History right away, the others show in their row when they end.
 */
export async function startSystemTask(taskId: SystemTaskId, by: string): Promise<TaskStart> {
    const name = DEFAULT_TASK_CONFIG[taskId].label;
    if (systemTaskService.isRunning(taskId)) return { started: false, reason: `${name} is running already.` };
    if (isDatabaseMaintenanceActive()) return { started: false, reason: "DBackup is optimizing or copying its database. Try again in a moment." };

    const run = systemTaskService.runTask(taskId, "Manual", by);
    if (taskId === SYSTEM_TASKS.INTEGRITY_CHECK) return { started: true, executionId: await run };
    run.catch((error: unknown) => log.error("System task failed", { taskId }, wrapError(error)));
    return { started: true };
}
