import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { updateService } from "./update-service";
import { healthCheckService } from "./healthcheck-service";
import { auditService } from "./audit-service";
import { PERMISSIONS } from "@/lib/permissions";

// Ensure adapters are registered for worker context
registerAdapters();

export const SYSTEM_TASKS = {
    UPDATE_DB_VERSIONS: "system.update_db_versions",
    HEALTH_CHECK: "system.health_check",
    CLEAN_OLD_LOGS: "system.clean_audit_logs",
    CHECK_FOR_UPDATES: "system.check_for_updates",
    SYNC_PERMISSIONS: "system.sync_permissions",
    CONFIG_BACKUP: "system.config_backup"
};

export const DEFAULT_TASK_CONFIG = {
    [SYSTEM_TASKS.UPDATE_DB_VERSIONS]: {
        interval: "0 * * * *", // Every hour
        runOnStartup: true,
        enabled: true,
        label: "Update Database Versions",
        description: "Checks connectivity and fetches version information from all configured database sources."
    },
    [SYSTEM_TASKS.SYNC_PERMISSIONS]: {
        interval: "0 0 * * *", // Daily at midnight
        runOnStartup: true,
        enabled: true,
        label: "Sync SuperAdmin Permissions",
        description: "Ensures the SuperAdmin group always has all available permissions."
    },
    [SYSTEM_TASKS.HEALTH_CHECK]: {
        interval: "*/1 * * * *", // Every minute
        runOnStartup: false,
        enabled: true,
        label: "Health Check & Connectivity",
        description: "Periodically pings all configured database and storage adapters to track availability and latency."
    },
    [SYSTEM_TASKS.CLEAN_OLD_LOGS]: {
        interval: "0 0 * * *", // Daily at midnight
        runOnStartup: true,
        enabled: true,
        label: "Clean Old Logs",
        description: "Removes audit logs older than the configured retention period (default: 90 days) to prevent disk filling."
    },
    [SYSTEM_TASKS.CHECK_FOR_UPDATES]: {
        interval: "0 0 * * *", // Daily at midnight
        runOnStartup: true,
        enabled: true,
        label: "Check for Updates",
        description: "Checks if a new version of the application is available in the GitLab Container Registry."
    },
    [SYSTEM_TASKS.CONFIG_BACKUP]: {
        interval: "0 3 * * *", // 3 AM
        runOnStartup: false,
        enabled: false, // Default disabled until user enables it
        label: "Automated Configuration Backup",
        description: "Backs up the internal system configuration (Settings, Adapters, Jobs, Users) to the configured storage."
    }
};

export class SystemTaskService {

    async getTaskEnabled(taskId: string): Promise<boolean> {
        // Special mapping for CONFIG_BACKUP to keep sync with Config Backup Settings page
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
             const legacyKey = "config.backup.enabled";
             const legacySetting = await prisma.systemSetting.findUnique({ where: { key: legacyKey } });
             if (legacySetting) return legacySetting.value === 'true';
             // Fallback to default config if not set
             return DEFAULT_TASK_CONFIG[taskId].enabled;
        }

        const key = `task.${taskId}.enabled`;
        const setting = await prisma.systemSetting.findUnique({ where: { key } });

        if (setting) {
            return setting.value === 'true';
        }

        // Return default if not set in DB
        // @ts-expect-error - enabled might not be in generic TaskConfig type implicitly but we added it above
        return DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]?.enabled ?? true;
    }

    async setTaskEnabled(taskId: string, enabled: boolean) {
        // Special mapping for CONFIG_BACKUP
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
             const legacyKey = "config.backup.enabled";
             await prisma.systemSetting.upsert({
                where: { key: legacyKey },
                update: { value: String(enabled) },
                create: { key: legacyKey, value: String(enabled), description: "Enable Automated Configuration Backup" }
            });
            return;
        }

        const key = `task.${taskId}.enabled`;
        const value = String(enabled);
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value, description: `Enabled status for ${taskId}` }
        });
    }

    async getTaskConfig(taskId: string) {
        // Special mapping: For CONFIG_BACKUP, we use the user-facing setting key if it exists
        // This ensures the Config Backup Settings UI remains the source of truth,
        // OR we migrate the logic to use task.* keys entirely.
        // Given the request to sync, we should probably make getTaskConfig look at the legacy key for this specific task
        // OR we update the Config Backup Settings UI to save to `task.system.config_backup.schedule`

        const key = `task.${taskId}.schedule`;
        if (taskId === SYSTEM_TASKS.CONFIG_BACKUP) {
             // Check custom key first, fallback to task key?
             // Actually, simplest is to use 'config.backup.schedule' as the key for this task
             const legacyKey = "config.backup.schedule";
             const legacySetting = await prisma.systemSetting.findUnique({ where: { key: legacyKey } });
             if (legacySetting) return legacySetting.value;
        }

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
            case SYSTEM_TASKS.SYNC_PERMISSIONS:
                await this.runSyncPermissions();
                break;
            case SYSTEM_TASKS.CHECK_FOR_UPDATES:
                await this.runCheckForUpdates();
                break;
            case SYSTEM_TASKS.CONFIG_BACKUP: {
                // Dynamic import to avoid circular dep if config-runner imports something that imports this.
                const { runConfigBackup } = await import("@/lib/runner/config-runner");
                await runConfigBackup();
                break;
            }
            default:
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

    private async runSyncPermissions() {
        try {
            console.log("[SystemTask] Syncing permissions for SuperAdmin group...");

            // Flatten all permissions from the source of truth
            const allPerms = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

            // Update SuperAdmin group(s)
            // Using updateMany to handle case if multiple groups somehow have this name (though name is unique in schema)
            const result = await prisma.group.updateMany({
                where: { name: "SuperAdmin" },
                data: { permissions: JSON.stringify(allPerms) }
            });

            if (result.count > 0) {
                console.log(`[SystemTask] Successfully updated permissions for ${result.count} SuperAdmin group(s).`);
            } else {
                console.log("[SystemTask] No 'SuperAdmin' group found. Skipping permission sync.");
            }

        } catch (error: any) {
            console.error(`[SystemTask] Failed to sync permissions: ${error.message}`);
        }
    }
}

export const systemTaskService = new SystemTaskService();
