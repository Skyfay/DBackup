import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { updateService } from "./update-service";
import { healthCheckService } from "./healthcheck-service";
import { auditService } from "./audit-service";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ service: "SystemTaskService" });

// Ensure adapters are registered for worker context
registerAdapters();

export const SYSTEM_TASKS = {
    UPDATE_DB_VERSIONS: "system.update_db_versions",
    HEALTH_CHECK: "system.health_check",
    CLEAN_OLD_LOGS: "system.clean_audit_logs",
    CHECK_FOR_UPDATES: "system.check_for_updates",
    SYNC_PERMISSIONS: "system.sync_permissions",
    CONFIG_BACKUP: "system.config_backup",
    INTEGRITY_CHECK: "system.integrity_check",
    REFRESH_STORAGE_STATS: "system.refresh_storage_stats"
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
        label: "Clean Old Data",
        description: "Removes old audit logs and storage snapshots beyond their configured retention periods to prevent disk filling."
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
    },
    [SYSTEM_TASKS.INTEGRITY_CHECK]: {
        interval: "0 4 * * 0", // Weekly on Sunday at 4 AM
        runOnStartup: false,
        enabled: false, // Default disabled - can be resource-intensive
        label: "Backup Integrity Check",
        description: "Verifies SHA-256 checksums of all backup files on storage to detect corruption or tampering. Downloads each file temporarily for verification."
    },
    [SYSTEM_TASKS.REFRESH_STORAGE_STATS]: {
        interval: "0 * * * *", // Every hour
        runOnStartup: true,
        enabled: true,
        label: "Refresh Storage Statistics",
        description: "Queries all storage destinations to update file counts and total sizes displayed on the dashboard. Runs automatically after each backup."
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
        log.info("Running system task", { taskId });

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
            case SYSTEM_TASKS.INTEGRITY_CHECK: {
                const { integrityService } = await import("@/services/integrity-service");
                const result = await integrityService.runFullIntegrityCheck();
                log.info("Integrity check results", {
                    total: result.totalFiles,
                    passed: result.passed,
                    failed: result.failed,
                    skipped: result.skipped
                });
                break;
            }
            case SYSTEM_TASKS.REFRESH_STORAGE_STATS: {
                const { refreshStorageStatsCache } = await import("@/services/dashboard-service");
                await refreshStorageStatsCache();
                break;
            }
            default:
                log.warn("Unknown system task", { taskId });
        }
    }

    private async runCleanOldLogs() {
        // Clean audit logs
        try {
            const auditSetting = await prisma.systemSetting.findUnique({ where: { key: "audit.retentionDays" } });
            const auditRetentionDays = auditSetting ? parseInt(auditSetting.value) : 90;

            log.info("Cleaning old audit logs", { retentionDays: auditRetentionDays });
            const deleted = await auditService.cleanOldLogs(auditRetentionDays);
            log.info("Audit log cleanup completed", { deletedCount: deleted.count });
        } catch (error: unknown) {
            log.error("Failed to clean audit logs", {}, wrapError(error));
        }

        // Clean old storage snapshots
        try {
            const snapshotSetting = await prisma.systemSetting.findUnique({ where: { key: "storage.snapshotRetentionDays" } });
            const snapshotRetentionDays = snapshotSetting ? parseInt(snapshotSetting.value) : 90;

            log.info("Cleaning old storage snapshots", { retentionDays: snapshotRetentionDays });
            const { cleanupOldSnapshots } = await import("@/services/dashboard-service");
            const snapshotsDeleted = await cleanupOldSnapshots(snapshotRetentionDays);
            if (snapshotsDeleted > 0) {
                log.info("Storage snapshot cleanup completed", { deletedCount: snapshotsDeleted });
            }
        } catch (error: unknown) {
            log.error("Failed to clean storage snapshots", {}, wrapError(error));
        }

        // Clean old notification logs
        try {
            const notifSetting = await prisma.systemSetting.findUnique({ where: { key: "notification.logRetentionDays" } });
            const notifRetentionDays = notifSetting ? parseInt(notifSetting.value) : 90;

            log.info("Cleaning old notification logs", { retentionDays: notifRetentionDays });
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - notifRetentionDays);
            const result = await prisma.notificationLog.deleteMany({
                where: { sentAt: { lt: cutoff } },
            });
            if (result.count > 0) {
                log.info("Notification log cleanup completed", { deletedCount: result.count });
            }
        } catch (error: unknown) {
            log.error("Failed to clean notification logs", {}, wrapError(error));
        }
    }

    private async runCheckForUpdates() {
        log.debug("Checking for updates");
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
                log.info("New version available", {
                    latestVersion: result.latestVersion,
                    currentVersion: result.currentVersion
                });
                // Future: Send notification?
            } else {
                log.debug("Application is up to date", { currentVersion: result.currentVersion });
            }
        } catch (error: unknown) {
            log.error("Update check failed", {}, wrapError(error));
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
                    log.warn("Adapter implementation not found", { adapterId: source.adapterId });
                    continue;
                }
                if (!adapter.test) {
                    log.debug("Adapter does not support test/version check", { adapterId: source.adapterId });
                    continue;
                }

                // Decrypt config
                let config;
                try {
                    config = decryptConfig(JSON.parse(source.config));
                } catch(e: unknown) {
                    log.error("Config decrypt failed", { sourceName: source.name }, wrapError(e));
                    continue;
                }

                log.debug("Testing connection", { sourceName: source.name, adapterId: source.adapterId });
                const result = await adapter.test(config);
                log.debug("Connection test result", { sourceName: source.name, success: result.success, version: result.version });

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
                    log.info("Updated database version", { sourceName: source.name, version: result.version });
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

            } catch (e: unknown) {
                log.error("Failed health check for source", { sourceName: source.name }, wrapError(e));
            }
        }
    }

    private async runSyncPermissions() {
        try {
            log.debug("Syncing permissions for SuperAdmin group");

            // Flatten all permissions from the source of truth
            const allPerms = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

            // Update SuperAdmin group(s)
            // Using updateMany to handle case if multiple groups somehow have this name (though name is unique in schema)
            const result = await prisma.group.updateMany({
                where: { name: "SuperAdmin" },
                data: { permissions: JSON.stringify(allPerms) }
            });

            if (result.count > 0) {
                log.info("Updated permissions for SuperAdmin groups", { count: result.count });
            } else {
                log.debug("No SuperAdmin group found, skipping permission sync");
            }

        } catch (error: unknown) {
            log.error("Failed to sync permissions", {}, wrapError(error));
        }
    }
}

export const systemTaskService = new SystemTaskService();
