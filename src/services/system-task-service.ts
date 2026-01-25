import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { updateService } from "./update-service";

// Ensure adapters are registered for worker context
registerAdapters();

export const SYSTEM_TASKS = {
    UPDATE_DB_VERSIONS: "system.update_db_versions",
    HEALTH_CHECK: "system.health_check",
    CLEAN_OLD_LOGS: "system.clean_audit_logs",
    CHECK_FOR_UPDATES: "system.check_for_updates"
};

export const DEFAULT_TASK_CONFIG = {
    [SYSTEM_TASKS.UPDATE_DB_VERSIONS]: {
        interval: "0 * * * *", // Every hour
        runOnStartup: true,
        label: "Update Database Versions",
        description: "Checks connectivity and fetches version information from all configured database sources."
    },
    [SYSTEM_TASKS.HEALTH_CHECK]: {
        interval: "*/1 * * * *", // Every minute
        runOnStartup: false,
        label: "Health Check & Connectivity",
        description: "Periodically pings all configured database and storage adapters to track availability and latency."
    },
    [SYSTEM_TASKS.CLEAN_OLD_LOGS]: {
        interval: "0 0 * * *", // Daily at midnight
        runOnStartup: true,
        label: "Clean Old Logs",
        description: "Removes audit logs older than the configured retention period (default: 90 days) to prevent disk filling."
    },
    [SYSTEM_TASKS.CHECK_FOR_UPDATES]: {
        interval: "0 0 * * *", // Daily at midnight
        runOnStartup: true,
        label: "Check for Updates",
        description: "Checks if a new version of the application is available in the GitLab Container Registry."
    }
};

export class SystemTaskService {

    async getTaskConfig(taskId: string) {
        const key = `task.${taskId}.schedule`;
        const setting = await prisma.systemSetting.findUnique({ where: { key } });
        return setting?.value || DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]?.interval;
    }

    async getTaskRunOnStartup(taskId: string): Promise<boolean> {
        const key = `task.${taskId}.runOnStartup`;
        const setting = await prisma.systemSetting.findUnique({ where: { key } });

        if (setting) {
            return setting.value === 'true';
        }

        // Return default if not set in DB
        // @ts-expect-error - runOnStartup is added to default config but inferred type might lag
        return DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]?.runOnStartup ?? false;
    }

    async setTaskRunOnStartup(taskId: string, enabled: boolean) {
        const key = `task.${taskId}.runOnStartup`;
        const value = String(enabled);
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value, description: `Run on startup for ${taskId}` }
        });
    }

    async setTaskConfig(taskId: string, schedule: string) {
        const key = `task.${taskId}.schedule`;
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value: schedule },
            create: { key, value: schedule, description: `Schedule for ${taskId}` }
        });
    }

    async runTask(taskId: string) {
        console.log(`[SystemTask] Running ${taskId}...`);

        switch (taskId) {
            case SYSTEM_TASKS.UPDATE_DB_VERSIONS:
                await this.runUpdateDbVersions();
                break;
            case SYSTEM_TASKS.HEALTH_CHECK:
                await healthCheckService.performHealthCheck();
                break;
            case SYSTEM_TASKS.CLEAN_OLD_LOGS:
                await this.runCleanOldLogs();
                break;
            default:
            case SYSTEM_TASKS.CHECK_FOR_UPDATES:
                await this.runCheckForUpdates();
                break;
                console.warn(`[SystemTask] Unknown task: ${taskId}`);
        }
    }

    private async runCleanOldLogs() {
        try {
            // Check if there is a configured retention period
            const retentionKey = "audit.retentionDays";
            const setting = await prisma.systemSetting.findUnique({ where: { key: retentionKey } });
            const retentionDays = setting ? parseInt(setting.value) : 90; // Default 90 days

            console.log(`[SystemTask] Cleaning audit logs older than ${retentionDays} days...`);
            const deleted = await auditService.cleanOldLogs(retentionDays);
            console.log(`[SystemTask] Deleted ${deleted.count} old audit logs.`);
        } catch (error: any) {
            console.error(`[SystemTask] Failed to clean audit logs: ${error.message}`);
        }
    }

    private async runCheckForUpdates() {
        console.log(`[SystemTask] Checking for updates...`);
        try {
            // The update service handles the "checkForUpdates" setting check internally in recent changes,
            // but we might want to skip logic if not needed. However, since this is a system task,
            // the user might have scheduled it.
            // The service call is lightweight (one API call if enabled).
            // We mainly call it to refresh the cache if Next.js cache is used, or simply to log output.

            // NOTE: Since the Sidebar checks on every render (with cache), this task is primarily
            // useful if we later implement *notifications* for updates (e.g. email).
            // For now, we simply execute it.
            const result = await updateService.checkForUpdates();

            if (result.updateAvailable) {
                console.log(`[SystemTask] New version available: ${result.latestVersion} (Current: ${result.currentVersion})`);
                // Future: Send notification?
            } else {
                console.log(`[SystemTask] Up to date (v${result.currentVersion}).`);
            }
        } catch (error: any) {
             console.error(`[SystemTask] Update check failed: ${error.message}`);
        }
    }

    private async runUpdateDbVersions() {
        const sources = await prisma.adapterConfig.findMany({
            where: { type: 'database' }
        });

        for (const source of sources) {
            try {
                const adapter = registry.get(source.adapterId) as DatabaseAdapter;
                if (!adapter) {
                    console.warn(`[SystemTask] Adapter implementation not found: ${source.adapterId}`);
                    continue;
                }
                if (!adapter.test) {
                    console.log(`[SystemTask] Adapter ${source.adapterId} does not support test/version check.`);
                    continue;
                }

                // Decrypt config
                let config;
                try {
                    config = decryptConfig(JSON.parse(source.config));
                } catch(e: any) {
                    console.error(`[SystemTask] Config decrypt failed for ${source.name}: ${e.message}`);
                    continue;
                }

                console.log(`[SystemTask] Testing connection for ${source.name} (${source.adapterId})...`);
                const result = await adapter.test(config);
                console.log(`[SystemTask] Result for ${source.name}: success=${result.success} version=${result.version}`);

                if (result.success && result.version) {
                    // Update Metadata
                    const currentMeta = source.metadata ? JSON.parse(source.metadata) : {};
                    const newMeta = {
                        ...currentMeta,
                        engineVersion: result.version,
                        lastCheck: new Date().toISOString(),
                        status: 'Online'
                    };

                    await prisma.adapterConfig.update({
                        where: { id: source.id },
                        data: { metadata: JSON.stringify(newMeta) }
                    });
                    console.log(`[SystemTask] Updated version for ${source.name}: ${result.version}`);
                } else {
                    // Mark as offline or warning?
                     const currentMeta = source.metadata ? JSON.parse(source.metadata) : {};
                     const newMeta = {
                        ...currentMeta,
                        status: 'Unreachable',
                        lastError: result.message
                     };
                     await prisma.adapterConfig.update({
                        where: { id: source.id },
                        data: { metadata: JSON.stringify(newMeta) }
                    });
                }

            } catch (e: any) {
                console.error(`[SystemTask] Failed check for ${source.name}:`, e);
            }
        }
    }
}

export const systemTaskService = new SystemTaskService();
