import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { isValidCron } from "@/lib/core/cron";
import { healthCheckService } from "./healthcheck-service";
import { logger } from "@/lib/logging/logger";
import { ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { runDataRetention } from "./data-retention-service";
import { isDatabaseMaintenanceActive } from "@/lib/server/database-maintenance";
import { DEFAULT_TASK_CONFIG, SYSTEM_TASKS } from "./system-task-definitions";
import { checkForUpdates, startIntegrityCheck, syncPermissions, updateDbVersions, warmupStorageCache, type TaskOutcome } from "./system-task-runs";

export { SYSTEM_TASKS, DEFAULT_TASK_CONFIG } from "./system-task-definitions";

const log = logger.child({ service: "SystemTaskService" });

// Ensure adapters are registered for worker context
registerAdapters();

/** How the last run of a task went, as the Settings page shows it. */
export interface TaskRunRecord {
    /** When it started. */
    at: string;
    /** How long it took, null when only the start is known from an older version. */
    durationMs: number | null;
    ok: boolean;
    summary: string | null;
    /** The run in History, for a task that writes one. */
    executionId?: string;
}

/** Settings of another part that switch a task on and off, so both always agree. */
const CONFIG_BACKUP_ENABLED = "config.backup.enabled";
const CONFIG_BACKUP_SCHEDULE = "config.backup.schedule";
const CHECK_FOR_UPDATES = "general.checkForUpdates";

/** The tasks running right now. On globalThis, since every bundle of Next.js loads this module anew. */
const globalForTasks = globalThis as unknown as { runningSystemTasks?: Set<string> };
const running = (globalForTasks.runningSystemTasks ??= new Set<string>());

const defaults = (taskId: string) => DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG];
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

async function readSetting(key: string): Promise<string | null> {
    return (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? null;
}

async function writeSetting(key: string, value: string, description?: string) {
    await prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, ...(description ? { description } : {}) },
    });
}

/** The stuck run watchdog lives in its own module, which pulls the queue in with it. */
const stuckTimeout = () => import("@/services/system/stuck-execution-service");

export class SystemTaskService {

    async getTaskEnabled(taskId: string): Promise<boolean> {
        // A task that follows a setting of another part is on exactly when that setting is.
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
            const value = await readSetting(CONFIG_BACKUP_ENABLED);
            return value === null ? DEFAULT_TASK_CONFIG[taskId].enabled : value === "true";
        }
        if (taskId === SYSTEM_TASKS.CHECK_FOR_UPDATES) {
            return (await readSetting(CHECK_FOR_UPDATES)) !== "false";
        }
        if (taskId === SYSTEM_TASKS.STUCK_EXECUTION_CHECK) {
            const { STUCK_TIMEOUT_SETTING } = await stuckTimeout();
            return (await readSetting(STUCK_TIMEOUT_SETTING)) !== "0";
        }

        const value = await readSetting(`task.${taskId}.enabled`);
        if (value !== null) return value === "true";

        // Return default if not set in DB
        return defaults(taskId)?.enabled ?? true;
    }

    async setTaskEnabled(taskId: string, enabled: boolean) {
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
            await writeSetting(CONFIG_BACKUP_ENABLED, String(enabled), "Enable Automated Configuration Backup");
            return;
        }
        if (taskId === SYSTEM_TASKS.CHECK_FOR_UPDATES) {
            await writeSetting(CHECK_FOR_UPDATES, String(enabled));
            return;
        }
        if (taskId === SYSTEM_TASKS.STUCK_EXECUTION_CHECK) {
            // Off is the timeout Never. On again brings back the default, unless a time is set.
            const { STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES } = await stuckTimeout();
            const current = await readSetting(STUCK_TIMEOUT_SETTING);
            if (!enabled) await writeSetting(STUCK_TIMEOUT_SETTING, "0");
            else if (current === "0") await writeSetting(STUCK_TIMEOUT_SETTING, String(DEFAULT_STUCK_TIMEOUT_MINUTES));
            return;
        }

        await writeSetting(`task.${taskId}.enabled`, String(enabled), `Enabled status for ${taskId}`);
    }

    async getTaskConfig(taskId: string) {
        // The schedule of the configuration backup is set in its own part. An older version
        // wrote it to the key of the task, which still counts when nothing newer is stored.
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
            const own = await readSetting(CONFIG_BACKUP_SCHEDULE);
            if (own) return own;
        }

        const value = await readSetting(`task.${taskId}.schedule`);
        return value || defaults(taskId)?.interval;
    }

    async setTaskConfig(taskId: string, schedule: string) {
        const trimmed = schedule.trim();
        if (!isValidCron(trimmed)) {
            throw new ValidationError(`The scheduler cannot read the schedule "${schedule}"`, { field: "schedule" });
        }
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
            await writeSetting(CONFIG_BACKUP_SCHEDULE, trimmed, "Schedule of the configuration backup");
            return;
        }
        await writeSetting(`task.${taskId}.schedule`, trimmed, `Schedule for ${taskId}`);
    }

    async getTaskRunOnStartup(taskId: string): Promise<boolean> {
        const value = await readSetting(`task.${taskId}.runOnStartup`);
        if (value !== null) return value === "true";

        // Return default if not set in DB
        return defaults(taskId)?.runOnStartup ?? false;
    }

    async setTaskRunOnStartup(taskId: string, enabled: boolean) {
        await writeSetting(`task.${taskId}.runOnStartup`, String(enabled), `Run on startup for ${taskId}`);
    }

    async getTaskLastRunAt(taskId: string): Promise<string | null> {
        return readSetting(`task.${taskId}.lastRunAt`);
    }

    /** How the last run went. A run of an older version left only its start. */
    async getTaskLastRun(taskId: string): Promise<TaskRunRecord | null> {
        const [record, startedAt] = await Promise.all([readSetting(`task.${taskId}.lastRun`), this.getTaskLastRunAt(taskId)]);
        if (record) {
            try {
                const parsed = JSON.parse(record) as TaskRunRecord;
                // A run started since the record was written has not ended yet, its start is newer.
                if (!startedAt || parsed.at >= startedAt) return parsed;
            } catch {
                // A broken record falls back to the start alone.
            }
        }
        return startedAt ? { at: startedAt, durationMs: null, ok: true, summary: null } : null;
    }

    isRunning(taskId: string): boolean {
        return running.has(taskId);
    }

    private async setTaskLastRunAt(taskId: string, at: Date) {
        await writeSetting(`task.${taskId}.lastRunAt`, at.toISOString(), `Last run timestamp for ${taskId}`);
    }

    private async recordRun(taskId: string, startedAt: Date, outcome: TaskOutcome) {
        running.delete(taskId);
        const record: TaskRunRecord = {
            at: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            ok: outcome.ok ?? true,
            summary: outcome.summary ?? null,
            ...(outcome.executionId ? { executionId: outcome.executionId } : {}),
        };
        try {
            await writeSetting(`task.${taskId}.lastRun`, JSON.stringify(record), `Last run of ${taskId}`);
        } catch (error: unknown) {
            log.warn("Could not record the run of a system task", { taskId }, wrapError(error));
        }
    }

    async runTask(taskId: string, triggerType?: "Manual" | "Scheduler", triggerLabel?: string): Promise<string | undefined> {
        // VACUUM or a database download holds Prisma's only connection. A task started now
        // would just queue behind it until the pool timeout fails it.
        if (isDatabaseMaintenanceActive()) {
            log.info("Skipping system task during database maintenance", { taskId });
            return undefined;
        }

        log.info("Running system task", { taskId });
        const startedAt = new Date();
        await this.setTaskLastRunAt(taskId, startedAt);
        running.add(taskId);

        let outcome: TaskOutcome;
        try {
            outcome = await this.execute(taskId, triggerType, triggerLabel, startedAt);
        } catch (error: unknown) {
            await this.recordRun(taskId, startedAt, { ok: false, summary: getErrorMessage(error) });
            throw error;
        }
        // A task that goes on in the background records itself when it ends.
        if (!outcome.pending) await this.recordRun(taskId, startedAt, outcome);
        return outcome.executionId;
    }

    private async execute(taskId: string, triggerType: "Manual" | "Scheduler" | undefined, triggerLabel: string | undefined, startedAt: Date): Promise<TaskOutcome> {
        switch (taskId) {
            case SYSTEM_TASKS.UPDATE_DB_VERSIONS:
                return updateDbVersions();
            case SYSTEM_TASKS.HEALTH_CHECK:
                await healthCheckService.performHealthCheck();
                return {};
            case SYSTEM_TASKS.STUCK_EXECUTION_CHECK: {
                const { sweepStuckExecutions } = await stuckTimeout();
                const sweep = await sweepStuckExecutions();
                if (sweep.cancelled > 0) return { ok: false, summary: `${plural(sweep.cancelled, "stuck run", "stuck runs")} failed` };
                return { summary: sweep.checked > 0 ? "Nothing stuck" : "Nothing running" };
            }
            case SYSTEM_TASKS.CLEAN_OLD_LOGS: {
                const result = await runDataRetention();
                const counts = Object.values(result);
                const removed = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
                return { summary: removed > 0 ? `${removed.toLocaleString("en-US")} removed` : "Nothing to remove" };
            }
            case SYSTEM_TASKS.SYNC_PERMISSIONS:
                return syncPermissions();
            case SYSTEM_TASKS.CHECK_FOR_UPDATES:
                return checkForUpdates();
            case SYSTEM_TASKS.CONFIG_BACKUP: {
                // Dynamic import to avoid circular dep if config-runner imports something that imports this.
                const { runConfigBackup } = await import("@/lib/runner/config-runner");
                const result = await runConfigBackup();
                if (!result) return {};
                return "skipped" in result ? { summary: result.skipped } : { summary: `To ${result.destination}` };
            }
            case SYSTEM_TASKS.INTEGRITY_CHECK:
                return startIntegrityCheck(triggerType, triggerLabel, (outcome) => this.recordRun(taskId, startedAt, outcome));
            case SYSTEM_TASKS.REFRESH_STORAGE_STATS: {
                const { refreshStorageStatsCache } = await import("@/services/dashboard-service");
                const volumes = await refreshStorageStatsCache();
                return Array.isArray(volumes) ? { summary: plural(volumes.length, "destination", "destinations") } : {};
            }
            case SYSTEM_TASKS.WARMUP_STORAGE_CACHE:
                return warmupStorageCache();
            default:
                log.warn("Unknown system task", { taskId });
                return {};
        }
    }
}

export const systemTaskService = new SystemTaskService();
