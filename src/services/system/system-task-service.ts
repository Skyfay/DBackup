import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { updateService } from "./update-service";
import { healthCheckService } from "./healthcheck-service";
import { auditService } from "../audit-service";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { getNotificationConfig } from "@/services/notifications/system-notification-service";
import { getEventDefinition } from "@/lib/notifications/events";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { recordVersionIfChanged } from "./db-version-service";

const log = logger.child({ service: "SystemTaskService" });

// Timeout for individual adapter connection tests (15 seconds)
const ADAPTER_TEST_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Adapter test timed out after ${ms}ms for ${label}`)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

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
    REFRESH_STORAGE_STATS: "system.refresh_storage_stats",
    WARMUP_STORAGE_CACHE: "system.warmup_storage_cache"
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
        description: "Checks if a new version of the application is available in the GitHub Container Registry."
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
    },
    [SYSTEM_TASKS.WARMUP_STORAGE_CACHE]: {
        interval: "0 * * * *", // Every hour
        runOnStartup: true,
        enabled: true,
        label: "Pre-warm Storage Cache",
        description: "Keeps the Storage Explorer cache fresh. Reconciles existing caches against remote storage to detect external changes, and pre-populates the cache for adapters not yet loaded."
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

    async getTaskLastRunAt(taskId: string): Promise<string | null> {
        const key = `task.${taskId}.lastRunAt`;
        const setting = await prisma.systemSetting.findUnique({ where: { key } });
        return setting?.value ?? null;
    }

    private async setTaskLastRunAt(taskId: string) {
        const key = `task.${taskId}.lastRunAt`;
        const value = new Date().toISOString();
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value, description: `Last run timestamp for ${taskId}` }
        });
    }

    async runTask(taskId: string, triggerType?: "Manual" | "Scheduler", triggerLabel?: string): Promise<string | undefined> {
        log.info("Running system task", { taskId });
        await this.setTaskLastRunAt(taskId);

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
                const { integrityService } = await import("@/services/backup/integrity-service");
                const { SystemTaskRunner } = await import("@/lib/runner/system-task-runner");
                const { INTEGRITY_CHECK_STAGES } = await import("@/lib/core/logs");
                const { getErrorMessage } = await import("@/lib/logging/errors");

                const runner = await SystemTaskRunner.create(
                    "IntegrityCheck",
                    triggerType ?? "Scheduler",
                    triggerLabel ?? "Scheduler"
                );

                // Run async without blocking so callers receive the executionId immediately.
                (async () => {
                    try {
                        await runner.start();
                        const result = await integrityService.runFullIntegrityCheck({
                            onLog: (msg, level, details) => runner.logEntry(msg, level ?? "info", "general", details),
                            onStage: (stage) => runner.setStage(stage),
                            onFileProgress: (done, total) => {
                                if (total > 0) runner.updateStageProgress((done / total) * 100);
                            },
                        });
                        runner.setStage(INTEGRITY_CHECK_STAGES.COMPLETED);
                        runner.logEntry(
                            `${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped of ${result.totalFiles} total`,
                            result.failed > 0 ? "warning" : "success"
                        );
                        await runner.finish("Success");
                        log.info("Integrity check completed", {
                            total: result.totalFiles,
                            passed: result.passed,
                            failed: result.failed,
                            skipped: result.skipped,
                        });
                    } catch (e: unknown) {
                        runner.logEntry(getErrorMessage(e), "error");
                        runner.setStage(INTEGRITY_CHECK_STAGES.FAILED);
                        await runner.finish("Failed");
                        log.error("Integrity check failed", {}, wrapError(e));
                    }
                })();

                return runner.id;
            }
            case SYSTEM_TASKS.REFRESH_STORAGE_STATS: {
                const { refreshStorageStatsCache } = await import("@/services/dashboard-service");
                await refreshStorageStatsCache();
                break;
            }
            case SYSTEM_TASKS.WARMUP_STORAGE_CACHE:
                await this.runWarmupStorageCache();
                break;
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
            const result = await updateService.checkForUpdates();

            if (result.updateAvailable) {
                log.info("New version available", {
                    latestVersion: result.latestVersion,
                    currentVersion: result.currentVersion
                });

                // Send notification with deduplication
                await this.notifyUpdateAvailable(result.latestVersion, result.currentVersion);
            } else {
                log.debug("Application is up to date", { currentVersion: result.currentVersion });

                // Reset notification state when no longer outdated
                await this.resetUpdateNotificationState();
            }
        } catch (error: unknown) {
            log.error("Update check failed", {}, wrapError(error));
        }
    }

    /**
     * Send update notification with deduplication.
     * - Sends immediately when a new version is first detected
     * - Re-sends after the configured reminder interval (or default 7 days) while still outdated
     * - Does NOT re-send if the same version was already notified within the interval
     */
    private async notifyUpdateAvailable(latestVersion: string, currentVersion: string) {
        const STATE_KEY = "update.notification.state";

        try {
            // Load existing state
            const row = await prisma.systemSetting.findUnique({ where: { key: STATE_KEY } });
            const state: { lastNotifiedVersion: string | null; lastNotifiedAt: string | null } =
                row ? JSON.parse(row.value) : { lastNotifiedVersion: null, lastNotifiedAt: null };

            // Determine reminder interval from notification config
            const config = await getNotificationConfig();
            const eventConfig = config.events[NOTIFICATION_EVENTS.UPDATE_AVAILABLE];
            const eventDef = getEventDefinition(NOTIFICATION_EVENTS.UPDATE_AVAILABLE);

            // Default reminder: 7 days (168 hours)
            const DEFAULT_REMINDER_HOURS = 168;
            let reminderMs = DEFAULT_REMINDER_HOURS * 60 * 60 * 1000;
            let reminderDisabled = false;

            if (eventDef?.supportsReminder && eventConfig?.reminderIntervalHours !== undefined && eventConfig.reminderIntervalHours !== null) {
                if (eventConfig.reminderIntervalHours === 0) {
                    reminderDisabled = true;
                } else {
                    reminderMs = eventConfig.reminderIntervalHours * 60 * 60 * 1000;
                }
            }

            // Decide if we should notify
            const isNewVersion = state.lastNotifiedVersion !== latestVersion;
            const cooldownElapsed = !reminderDisabled && (!state.lastNotifiedAt ||
                (Date.now() - new Date(state.lastNotifiedAt).getTime() >= reminderMs));

            if (!isNewVersion && !cooldownElapsed) {
                log.debug("Skipping update notification (already notified, cooldown active)", {
                    lastNotifiedVersion: state.lastNotifiedVersion,
                    lastNotifiedAt: state.lastNotifiedAt,
                });
                return;
            }

            // Dispatch notification
            await notify({
                eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
                data: {
                    latestVersion,
                    currentVersion,
                    releaseUrl: "https://github.com/Skyfay/DBackup/releases",
                    timestamp: new Date().toISOString(),
                },
            });

            // Update state
            const newState = {
                lastNotifiedVersion: latestVersion,
                lastNotifiedAt: new Date().toISOString(),
            };
            await prisma.systemSetting.upsert({
                where: { key: STATE_KEY },
                update: { value: JSON.stringify(newState) },
                create: {
                    key: STATE_KEY,
                    value: JSON.stringify(newState),
                    description: "Update notification deduplication state",
                },
            });

            log.info("Update notification sent", { latestVersion, isNewVersion });
        } catch (error: unknown) {
            log.error("Failed to send update notification", {}, wrapError(error));
        }
    }

    /** Reset update notification state when the app is up to date (allows re-notification for future updates) */
    private async resetUpdateNotificationState() {
        const STATE_KEY = "update.notification.state";
        try {
            await prisma.systemSetting.deleteMany({ where: { key: STATE_KEY } });
        } catch {
            // Ignore - state might not exist
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

                // Resolve config (merges credential profile if present)
                let config;
                try {
                    config = await resolveAdapterConfig(source);
                } catch(e: unknown) {
                    log.error("Config decrypt failed", { sourceName: source.name }, wrapError(e));
                    continue;
                }

                log.debug("Testing connection", { sourceName: source.name, adapterId: source.adapterId });
                const result = await withTimeout(
                    adapter.test(config),
                    ADAPTER_TEST_TIMEOUT_MS,
                    source.name
                );
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

                    // Record version-history entry only when the detected version differs
                    // from the last stored entry. Dispatches a notification on change.
                    try {
                        // The MSSQL adapter additionally returns `edition` even though it's not
                        // declared on the shared interface.
                        const edition = (result as { edition?: string }).edition;
                        const change = await recordVersionIfChanged(source.id, result.version, edition);
                        if (change.changed && change.previousVersion !== null) {
                            // Skip notification for the very first recorded entry per source
                            // (previousVersion === null) - that's just the baseline.
                            await notify({
                                eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
                                data: {
                                    sourceName: source.name,
                                    sourceId: source.id,
                                    adapterId: source.adapterId,
                                    previousVersion: change.previousVersion,
                                    newVersion: change.newVersion,
                                    edition,
                                    timestamp: new Date().toISOString(),
                                },
                            });
                        }
                    } catch (e: unknown) {
                        log.error("Failed to record/notify version change", { sourceName: source.name }, wrapError(e));
                    }
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

    private async runWarmupStorageCache() {
        const adapters = await prisma.adapterConfig.findMany({
            where: { type: "storage" },
            select: { id: true, name: true },
        });
        log.info("Pre-warming storage cache", { count: adapters.length });
        const { storageService } = await import("@/services/storage/storage-service");
        for (const adapter of adapters) {
            try {
                // If a cache row already exists: reconcile against remote to detect external changes.
                // If no cache row: do a full fetch to populate it.
                const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId: adapter.id } });
                if (cached) {
                    await storageService.reconcileStorageListCache(adapter.id);
                    log.debug("Reconciled storage cache", { adapterId: adapter.id, name: adapter.name });
                } else {
                    await storageService.listFilesWithMetadata(adapter.id);
                    log.debug("Warmed storage cache", { adapterId: adapter.id, name: adapter.name });
                }
            } catch (e: unknown) {
                log.warn("Failed to warm/reconcile cache for adapter", { adapterId: adapter.id, name: adapter.name }, wrapError(e));
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
