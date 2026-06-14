import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import {
    SystemTaskService,
    SYSTEM_TASKS,
    DEFAULT_TASK_CONFIG,
} from '@/services/system/system-task-service';

// Mock all heavy dependencies - we only test the getter/setter logic here
vi.mock('@/lib/core/registry', () => ({ registry: { get: vi.fn() } }));
vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));
vi.mock('@/lib/adapters/config-resolver', () => ({ resolveAdapterConfig: vi.fn() }));
vi.mock('@/services/system/update-service', () => ({
    updateService: { checkForUpdates: vi.fn().mockResolvedValue({ updateAvailable: false }) },
}));
vi.mock('@/services/system/healthcheck-service', () => ({
    healthCheckService: { performHealthCheck: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/services/audit-service', () => ({
    auditService: { cleanOldLogs: vi.fn().mockResolvedValue({ count: 0 }) },
}));
vi.mock('@/services/notifications/system-notification-service', () => ({
    notify: vi.fn(),
    getNotificationConfig: vi.fn().mockResolvedValue({ events: {} }),
}));
vi.mock('@/lib/notifications/events', () => ({
    getEventDefinition: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/auth/permissions', () => ({
    PERMISSIONS: { SYSTEM: { ADMIN: 'system.admin' } },
}));

// Dynamic-import mocks (used inside runTask() switch branches)
vi.mock('@/lib/runner/config-runner', () => ({
    runConfigBackup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/backup/integrity-service', () => ({
    integrityService: {
        runFullIntegrityCheck: vi.fn().mockResolvedValue({ totalFiles: 5, passed: 5, failed: 0, skipped: 0 }),
    },
}));
vi.mock('@/lib/runner/system-task-runner', () => ({
    SystemTaskRunner: {
        create: vi.fn().mockResolvedValue({
            id: 'runner-exec-1',
            start: vi.fn().mockResolvedValue(undefined),
            finish: vi.fn().mockResolvedValue(undefined),
            logEntry: vi.fn(),
            setStage: vi.fn(),
            setProgress: vi.fn(),
        }),
    },
    INTEGRITY_CHECK_STAGE_PROGRESS_MAP: {},
}));
vi.mock('@/services/dashboard-service', () => ({
    refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined),
    cleanupOldSnapshots: vi.fn().mockResolvedValue(3),
}));
vi.mock('@/services/system/db-version-service', () => ({
    recordVersionIfChanged: vi.fn().mockResolvedValue({ changed: false, previousVersion: null, newVersion: '' }),
}));

describe('SystemTaskService', () => {
    let service: SystemTaskService;

    beforeEach(() => {
        service = new SystemTaskService();
    });

    describe('getTaskEnabled()', () => {
        it('returns true from DB setting when set', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'task.x.enabled', value: 'true' } as any);

            const result = await service.getTaskEnabled(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe(true);
        });

        it('returns false from DB setting when set to false', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'task.x.enabled', value: 'false' } as any);

            const result = await service.getTaskEnabled(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe(false);
        });

        it('returns default config value when no DB setting exists', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);

            const result = await service.getTaskEnabled(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe(DEFAULT_TASK_CONFIG[SYSTEM_TASKS.HEALTH_CHECK].enabled);
        });

        it('uses legacy key for CONFIG_BACKUP', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'config.backup.enabled', value: 'true' } as any);

            const result = await service.getTaskEnabled(SYSTEM_TASKS.CONFIG_BACKUP);

            expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledWith({
                where: { key: 'config.backup.enabled' },
            });
            expect(result).toBe(true);
        });
    });

    describe('setTaskEnabled()', () => {
        it('upserts task enabled setting', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.setTaskEnabled(SYSTEM_TASKS.HEALTH_CHECK, true);

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: `task.${SYSTEM_TASKS.HEALTH_CHECK}.enabled` },
                    update: { value: 'true' },
                })
            );
        });

        it('uses legacy key for CONFIG_BACKUP', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.setTaskEnabled(SYSTEM_TASKS.CONFIG_BACKUP, false);

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: 'config.backup.enabled' },
                    update: { value: 'false' },
                })
            );
        });
    });

    describe('getTaskConfig()', () => {
        it('returns schedule from DB when set', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'task.x.schedule', value: '0 5 * * *' } as any);

            const result = await service.getTaskConfig(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe('0 5 * * *');
        });

        it('returns default interval when DB has no entry', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);

            const result = await service.getTaskConfig(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe(DEFAULT_TASK_CONFIG[SYSTEM_TASKS.HEALTH_CHECK].interval);
        });
    });

    describe('getTaskRunOnStartup()', () => {
        it('returns true from DB when set', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'task.x.runOnStartup', value: 'true' } as any);

            const result = await service.getTaskRunOnStartup(SYSTEM_TASKS.CLEAN_OLD_LOGS);

            expect(result).toBe(true);
        });

        it('returns default when no DB entry', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);

            const result = await service.getTaskRunOnStartup(SYSTEM_TASKS.CLEAN_OLD_LOGS);

            expect(result).toBe(DEFAULT_TASK_CONFIG[SYSTEM_TASKS.CLEAN_OLD_LOGS].runOnStartup);
        });
    });

    describe('setTaskConfig()', () => {
        it('upserts schedule setting', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.setTaskConfig(SYSTEM_TASKS.HEALTH_CHECK, '*/5 * * * *');

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: `task.${SYSTEM_TASKS.HEALTH_CHECK}.schedule` },
                    update: { value: '*/5 * * * *' },
                })
            );
        });
    });

    describe('SYSTEM_TASKS constants', () => {
        it('exports the expected task identifiers', () => {
            expect(SYSTEM_TASKS.HEALTH_CHECK).toBeDefined();
            expect(SYSTEM_TASKS.CLEAN_OLD_LOGS).toBeDefined();
            expect(SYSTEM_TASKS.CHECK_FOR_UPDATES).toBeDefined();
            expect(SYSTEM_TASKS.SYNC_PERMISSIONS).toBeDefined();
            expect(SYSTEM_TASKS.UPDATE_DB_VERSIONS).toBeDefined();
        });
    });

    describe('DEFAULT_TASK_CONFIG', () => {
        it('has a config entry for each SYSTEM_TASK', () => {
            for (const taskId of Object.values(SYSTEM_TASKS)) {
                expect(DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]).toBeDefined();
            }
        });

        it('each config has an interval, runOnStartup and enabled field', () => {
            for (const config of Object.values(DEFAULT_TASK_CONFIG)) {
                expect(config.interval).toBeTruthy();
                expect(typeof config.runOnStartup).toBe('boolean');
                expect(typeof config.enabled).toBe('boolean');
            }
        });
    });

    describe('runTask()', () => {
        it('calls healthCheckService.performHealthCheck for HEALTH_CHECK', async () => {
            const { healthCheckService } = await import('@/services/system/healthcheck-service');

            await service.runTask(SYSTEM_TASKS.HEALTH_CHECK);

            expect(healthCheckService.performHealthCheck).toHaveBeenCalledTimes(1);
        });

        it('calls auditService.cleanOldLogs for CLEAN_OLD_LOGS', async () => {
            const { auditService } = await import('@/services/audit-service');
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.notificationLog.deleteMany.mockResolvedValue({ count: 0 });

            await service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS);

            expect(auditService.cleanOldLogs).toHaveBeenCalled();
        });

        it('cleans notification logs with custom retention days', async () => {
            prismaMock.systemSetting.findUnique
                .mockResolvedValueOnce(null) // audit retention
                .mockResolvedValueOnce(null) // snapshot retention
                .mockResolvedValueOnce({ key: 'notification.logRetentionDays', value: '30' } as any);
            prismaMock.notificationLog.deleteMany.mockResolvedValue({ count: 5 });

            await service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS);

            expect(prismaMock.notificationLog.deleteMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { sentAt: { lt: expect.any(Date) } } })
            );
        });

        it('calls updateService.checkForUpdates for CHECK_FOR_UPDATES', async () => {
            const { updateService } = await import('@/services/system/update-service');

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            expect(updateService.checkForUpdates).toHaveBeenCalledTimes(1);
        });

        it('calls prisma.group.updateMany for SYNC_PERMISSIONS', async () => {
            prismaMock.group.updateMany.mockResolvedValue({ count: 1 });

            await service.runTask(SYSTEM_TASKS.SYNC_PERMISSIONS);

            expect(prismaMock.group.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { name: 'SuperAdmin' } })
            );
        });

        it('calls runConfigBackup for CONFIG_BACKUP', async () => {
            const { runConfigBackup } = await import('@/lib/runner/config-runner');

            await service.runTask(SYSTEM_TASKS.CONFIG_BACKUP);

            expect(runConfigBackup).toHaveBeenCalledTimes(1);
        });

        it('calls integrityService.runFullIntegrityCheck for INTEGRITY_CHECK', async () => {
            const { integrityService } = await import('@/services/backup/integrity-service');

            await service.runTask(SYSTEM_TASKS.INTEGRITY_CHECK);

            expect(integrityService.runFullIntegrityCheck).toHaveBeenCalledTimes(1);
        });

        it('calls refreshStorageStatsCache for REFRESH_STORAGE_STATS', async () => {
            const { refreshStorageStatsCache } = await import('@/services/dashboard-service');

            await service.runTask(SYSTEM_TASKS.REFRESH_STORAGE_STATS);

            expect(refreshStorageStatsCache).toHaveBeenCalledTimes(1);
        });

        it('handles SYNC_PERMISSIONS when prisma throws without propagating', async () => {
            prismaMock.group.updateMany.mockRejectedValue(new Error('DB error'));

            await expect(service.runTask(SYSTEM_TASKS.SYNC_PERMISSIONS)).resolves.toBeUndefined();
        });

        it('updates database versions and marks source as Unreachable when test fails', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ metadata: expect.stringContaining('Unreachable') }),
            }));
        });

        it('updates database versions and stores engineVersion when test succeeds', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true, version: '8.0.31' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ metadata: expect.stringContaining('8.0.31') }),
            }));
        });

        it('skips source when adapter has no test() method for UPDATE_DB_VERSIONS', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({ /* no test fn */ } as any);

            await expect(service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS)).resolves.toBeUndefined();
            expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
        });

        it('skips source when adapter is not found for UPDATE_DB_VERSIONS', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue(null as any);

            await expect(service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS)).resolves.toBeUndefined();
        });

        it('handles resolveAdapterConfig failure for UPDATE_DB_VERSIONS gracefully', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({ test: vi.fn() } as any);
            vi.mocked(resolveAdapterConfig).mockRejectedValue(new Error('decrypt error'));

            await expect(service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS)).resolves.toBeUndefined();
            expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
        });

        it('calls notifyUpdateAvailable when update is available', async () => {
            const { updateService } = await import('@/services/system/update-service');
            const { notify } = await import('@/services/notifications/system-notification-service');
            vi.mocked(updateService.checkForUpdates).mockResolvedValue({
                updateAvailable: true,
                latestVersion: 'v3.0.0',
                currentVersion: '2.0.0',
            });
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            expect(notify).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'update_available',
            }));
        });

        it('resets update state when no update is available', async () => {
            const { updateService } = await import('@/services/system/update-service');
            vi.mocked(updateService.checkForUpdates).mockResolvedValue({
                updateAvailable: false,
                latestVersion: '2.0.0',
                currentVersion: '2.0.0',
            });
            prismaMock.systemSetting.deleteMany.mockResolvedValue({ count: 1 } as any);

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            expect(prismaMock.systemSetting.deleteMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { key: 'update.notification.state' } })
            );
        });

        it('skips update notification when same version was already notified within cooldown', async () => {
            const { updateService } = await import('@/services/system/update-service');
            const { notify } = await import('@/services/notifications/system-notification-service');
            vi.mocked(updateService.checkForUpdates).mockResolvedValue({
                updateAvailable: true,
                latestVersion: 'v3.0.0',
                currentVersion: '2.0.0',
            });
            // State: v3.0.0 notified 1 hour ago, cooldown 168h (default)
            const state = JSON.stringify({
                lastNotifiedVersion: 'v3.0.0',
                lastNotifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            });
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'update.notification.state', value: state } as any);

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            expect(notify).not.toHaveBeenCalled();
        });

        it('handles CHECK_FOR_UPDATES when updateService throws', async () => {
            const { updateService } = await import('@/services/system/update-service');
            vi.mocked(updateService.checkForUpdates).mockRejectedValue(new Error('network error'));

            await expect(service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES)).resolves.toBeUndefined();
        });

        it('skips update notification when reminder is disabled (reminderIntervalHours = 0) and version is same', async () => {
            const { updateService } = await import('@/services/system/update-service');
            const { notify, getNotificationConfig } = await import('@/services/notifications/system-notification-service');
            const { getEventDefinition } = await import('@/lib/notifications/events');
            vi.mocked(updateService.checkForUpdates).mockResolvedValue({
                updateAvailable: true,
                latestVersion: 'v3.0.0',
                currentVersion: '2.0.0',
            });
            vi.mocked(getNotificationConfig).mockResolvedValue({
                events: { update_available: { reminderIntervalHours: 0 } }
            } as any);
            vi.mocked(getEventDefinition).mockReturnValue({ supportsReminder: true } as any);
            // Already notified for same version
            const state = JSON.stringify({
                lastNotifiedVersion: 'v3.0.0',
                lastNotifiedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
            });
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'update.notification.state', value: state } as any);

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            // reminderDisabled=true, same version → skip notification
            expect(notify).not.toHaveBeenCalled();
        });

        it('marks source as Unreachable when test returns success=true but no version', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true }) // no version field
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ metadata: expect.stringContaining('Unreachable') }),
            }));
        });

        it('records lastRunAt timestamp when runTask is called', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.HEALTH_CHECK);

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: `task.${SYSTEM_TASKS.HEALTH_CHECK}.lastRunAt` },
                    update: { value: expect.any(String) },
                })
            );
        });
    });

    describe('getTaskEnabled() - CONFIG_BACKUP fallback', () => {
        it('returns default value when no legacy setting exists for CONFIG_BACKUP', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);

            const result = await service.getTaskEnabled(SYSTEM_TASKS.CONFIG_BACKUP);

            expect(result).toBe(DEFAULT_TASK_CONFIG[SYSTEM_TASKS.CONFIG_BACKUP].enabled);
        });
    });

    describe('getTaskConfig() - CONFIG_BACKUP legacy schedule', () => {
        it('returns legacy schedule value for CONFIG_BACKUP when set', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue({
                key: 'config.backup.schedule',
                value: '0 4 * * *',
            } as any);

            const result = await service.getTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP);

            expect(result).toBe('0 4 * * *');
        });
    });

    describe('setTaskRunOnStartup()', () => {
        it('upserts runOnStartup setting', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.setTaskRunOnStartup(SYSTEM_TASKS.UPDATE_DB_VERSIONS, true);

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: `task.${SYSTEM_TASKS.UPDATE_DB_VERSIONS}.runOnStartup` },
                    update: { value: 'true' },
                })
            );
        });

        it('upserts runOnStartup to false', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.setTaskRunOnStartup(SYSTEM_TASKS.HEALTH_CHECK, false);

            expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: { value: 'false' },
                })
            );
        });
    });

    describe('runTask() - additional edge cases', () => {
        it('logs warning for unknown task id', async () => {
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await expect(service.runTask('system.unknown_task')).resolves.toBeUndefined();
        });

        it('handles auditService.cleanOldLogs failure gracefully', async () => {
            const { auditService } = await import('@/services/audit-service');
            vi.mocked(auditService.cleanOldLogs).mockRejectedValueOnce(new Error('DB error'));
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.notificationLog.deleteMany.mockResolvedValue({ count: 0 });

            await expect(service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS)).resolves.toBeUndefined();
        });

        it('handles cleanupOldSnapshots failure gracefully', async () => {
            const { cleanupOldSnapshots } = await import('@/services/dashboard-service');
            vi.mocked(cleanupOldSnapshots).mockRejectedValueOnce(new Error('Storage error'));
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.notificationLog.deleteMany.mockResolvedValue({ count: 0 });

            await expect(service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS)).resolves.toBeUndefined();
        });

        it('handles notificationLog.deleteMany failure gracefully', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.notificationLog.deleteMany.mockRejectedValueOnce(new Error('DB write failed'));

            await expect(service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS)).resolves.toBeUndefined();
        });

        it('notifies with non-zero reminderIntervalHours for update_available event', async () => {
            const { updateService } = await import('@/services/system/update-service');
            const { notify, getNotificationConfig } = await import('@/services/notifications/system-notification-service');
            const { getEventDefinition } = await import('@/lib/notifications/events');
            vi.mocked(updateService.checkForUpdates).mockResolvedValue({
                updateAvailable: true,
                latestVersion: 'v5.0.0',
                currentVersion: '2.0.0',
            });
            vi.mocked(getNotificationConfig).mockResolvedValue({
                events: { update_available: { reminderIntervalHours: 48 } }
            } as any);
            vi.mocked(getEventDefinition).mockReturnValue({ supportsReminder: true } as any);
            // No existing notification state - first time notifying
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            prismaMock.systemSetting.upsert.mockResolvedValue({} as any);

            await service.runTask(SYSTEM_TASKS.CHECK_FOR_UPDATES);

            expect(notify).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'update_available',
            }));
        });

        it('handles adapter.test() promise rejection during UPDATE_DB_VERSIONS', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src1', name: 'TestDB', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockRejectedValue(new Error('timeout'))
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);

            await expect(service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS)).resolves.toBeUndefined();
        });

        it('logs when no SuperAdmin group is found during SYNC_PERMISSIONS', async () => {
            prismaMock.group.updateMany.mockResolvedValue({ count: 0 });

            await service.runTask(SYSTEM_TASKS.SYNC_PERMISSIONS);

            // No assertion on log output - just verify it runs without error
            expect(prismaMock.group.updateMany).toHaveBeenCalled();
        });
    });

    describe('getTaskLastRunAt()', () => {
        it('returns ISO timestamp string from DB when set', async () => {
            const ts = new Date().toISOString();
            prismaMock.systemSetting.findUnique.mockResolvedValue({ key: `task.${SYSTEM_TASKS.HEALTH_CHECK}.lastRunAt`, value: ts } as any);

            const result = await service.getTaskLastRunAt(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBe(ts);
        });

        it('returns null when no DB entry exists', async () => {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);

            const result = await service.getTaskLastRunAt(SYSTEM_TASKS.HEALTH_CHECK);

            expect(result).toBeNull();
        });
    });

    describe('UPDATE_DB_VERSIONS - version-change notifications', () => {
        it('dispatches db_version_changed notification when version differs from previous entry', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            const { recordVersionIfChanged } = await import('@/services/system/db-version-service');
            const { notify } = await import('@/services/notifications/system-notification-service');

            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src-mssql', name: 'Prod MSSQL', adapterId: 'mssql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true, version: '15.0.4360.2', edition: 'Enterprise Edition' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);
            vi.mocked(recordVersionIfChanged).mockResolvedValue({
                changed: true,
                previousVersion: '15.0.4280.7',
                newVersion: '15.0.4360.2',
                isDowngrade: false,
            });

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(recordVersionIfChanged).toHaveBeenCalledWith('src-mssql', '15.0.4360.2', 'Enterprise Edition');
            expect(notify).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'db_version_changed',
                data: expect.objectContaining({
                    sourceName: 'Prod MSSQL',
                    sourceId: 'src-mssql',
                    adapterId: 'mssql',
                    previousVersion: '15.0.4280.7',
                    newVersion: '15.0.4360.2',
                    edition: 'Enterprise Edition',
                }),
            }));
        });

        it('skips notification on first observation (previousVersion === null baseline)', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            const { recordVersionIfChanged } = await import('@/services/system/db-version-service');
            const { notify } = await import('@/services/notifications/system-notification-service');

            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src-mysql', name: 'New MySQL', adapterId: 'mysql', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true, version: '8.0.31' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);
            vi.mocked(notify).mockClear();
            vi.mocked(recordVersionIfChanged).mockResolvedValue({
                changed: true,
                previousVersion: null,
                newVersion: '8.0.31',
                isDowngrade: false,
            });

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(recordVersionIfChanged).toHaveBeenCalled();
            expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'db_version_changed' }));
        });

        it('does not notify when recordVersionIfChanged reports no change', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            const { recordVersionIfChanged } = await import('@/services/system/db-version-service');
            const { notify } = await import('@/services/notifications/system-notification-service');

            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src-pg', name: 'PG', adapterId: 'postgres', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true, version: '16.2' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);
            vi.mocked(notify).mockClear();
            vi.mocked(recordVersionIfChanged).mockResolvedValue({
                changed: false,
                previousVersion: '16.2',
                newVersion: '16.2',
                isDowngrade: false,
            });

            await service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS);

            expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'db_version_changed' }));
        });

        it('does not crash the task when recordVersionIfChanged throws', async () => {
            const { registry: reg } = await import('@/lib/core/registry');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            const { recordVersionIfChanged } = await import('@/services/system/db-version-service');

            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'src-redis', name: 'Redis', adapterId: 'redis', type: 'database', metadata: '{}' }
            ] as any);
            vi.mocked(reg.get).mockReturnValue({
                test: vi.fn().mockResolvedValue({ success: true, version: '7.2.0' })
            } as any);
            vi.mocked(resolveAdapterConfig).mockResolvedValue({} as any);
            prismaMock.adapterConfig.update.mockResolvedValue({} as any);
            vi.mocked(recordVersionIfChanged).mockRejectedValue(new Error('db down'));

            await expect(service.runTask(SYSTEM_TASKS.UPDATE_DB_VERSIONS)).resolves.toBeUndefined();
            // adapterConfig.update for the metadata version write still happened
            expect(prismaMock.adapterConfig.update).toHaveBeenCalled();
        });
    });
});
