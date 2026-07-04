import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { HealthCheckService } from '@/services/system/healthcheck-service';
import { registry } from '@/lib/core/registry';
import { resolveAdapterConfig } from '@/lib/adapters/config-resolver';

// Mock registry and crypto
vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn()
    }
}));

vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((config) => config)
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({}),
}));

const mockNotify = vi.fn().mockResolvedValue(undefined);
const mockGetNotificationConfig = vi.fn().mockResolvedValue({
    events: {},
});
vi.mock('@/services/notifications/system-notification-service', () => ({
    notify: (...args: unknown[]) => mockNotify(...args),
    getNotificationConfig: () => mockGetNotificationConfig(),
}));

describe('HealthCheckService', () => {
    let service: HealthCheckService;

    // Use a fresh instance for each test to avoid side effects if any state is kept
    // But since the service is a singleton in real app, we need to inspect how it's exported.
    // It is exported as an instance `healthCheckService`. We can test the class if we export it,
    // or we can test the instance but we need to reset mocks.

    // WORKAROUND: In unit tests it's better to instantiate the class if possible.
    // Since the class is exported as `export class HealthCheckService`, we can instantiate it.

    beforeEach(() => {
        service = new HealthCheckService();
        vi.clearAllMocks();
        // Default safe mock for log retention cleanup
        prismaMock.healthCheckLog.deleteMany.mockResolvedValue({ count: 0 } as any);
    });

    it('should run checks for all adapters and update status', async () => {
        // Arrange
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database' }
        ];

        // Mock DB find
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        // Mock Adapter Registry
        const mockMySQLAdapter = {
            test: vi.fn().mockResolvedValue({ success: true, message: 'OK' })
        };
        (registry.get as any).mockReturnValue(mockMySQLAdapter);

        // Act
        await service.performHealthCheck();

        // Assert
        expect(registry.get).toHaveBeenCalledWith('mysql');
        expect(mockMySQLAdapter.test).toHaveBeenCalled();

        // Check DB Updates
        expect(prismaMock.healthCheckLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                adapterConfigId: '1',
                status: 'ONLINE',
                error: null
            })
        }));

        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: '1' },
            data: expect.objectContaining({
                lastStatus: 'ONLINE',
                consecutiveFailures: 0
            })
        }));
    });

    it('should transition to DEGRADED on first failure', async () => {
        // Arrange
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        const mockMySQLAdapter = {
            test: vi.fn().mockResolvedValue({ success: false, message: 'Connection refused' })
        };
        (registry.get as any).mockReturnValue(mockMySQLAdapter);

        // Act
        await service.performHealthCheck();

        // Assert
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                lastStatus: 'DEGRADED',
                consecutiveFailures: 1
            })
        }));
    });

    it('should transition to OFFLINE after 3 consecutive failures', async () => {
        // Arrange
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 2, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        const mockMySQLAdapter = {
            test: vi.fn().mockResolvedValue({ success: false, message: 'Connection refused' })
        };
        (registry.get as any).mockReturnValue(mockMySQLAdapter);

        // Act
        await service.performHealthCheck();

        // Assert
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                lastStatus: 'OFFLINE',
                consecutiveFailures: 3
            })
        }));
    });

    it('should recover from OFFLINE to ONLINE immediately on success', async () => {
         // Arrange
         const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 5, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        const mockMySQLAdapter = {
            test: vi.fn().mockResolvedValue({ success: true, message: 'OK' })
        };
        (registry.get as any).mockReturnValue(mockMySQLAdapter);

        // Act
        await service.performHealthCheck();

        // Assert
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                lastStatus: 'ONLINE',
                consecutiveFailures: 0
            })
        }));
    });

    it('should clean up old logs older than the given retention period', async () => {
        // Arrange
        prismaMock.healthCheckLog.deleteMany.mockResolvedValue({ count: 10 } as any);

        // Act
        const deletedCount = await service.cleanOldLogs(2);

        // Assert
        expect(prismaMock.healthCheckLog.deleteMany).toHaveBeenCalledWith({
            where: { createdAt: { lt: expect.any(Date) } },
        });
        expect(deletedCount).toBe(10);
    });

    it('should handle adapter not found by setting status to OFFLINE via catch', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'unknown-adapter', config: '{}', consecutiveFailures: 2, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        (registry.get as any).mockReturnValue(null);

        await service.performHealthCheck();

        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ lastStatus: 'OFFLINE' })
        }));
    });

    it('should skip adapter that does not support test()', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        (registry.get as any).mockReturnValue({ /* no test fn */ });

        await service.performHealthCheck();

        // No log or update should be created for adapters without test support
        expect(prismaMock.healthCheckLog.create).not.toHaveBeenCalled();
    });

    it('should set errorMsg from result.message on failed test', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database' }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'Timeout on port 3306' })
        });

        await service.performHealthCheck();

        expect(prismaMock.healthCheckLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ error: 'Timeout on port 3306' })
        }));
    });

    it('should send OFFLINE notification when adapter first goes offline', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 2, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
        });

        await service.performHealthCheck();

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'connection_offline',
        }));
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalled();
    });

    it('should send recovery notification when adapter comes back online', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 5, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        // Stored offline state with active notification
        const offlineState = JSON.stringify({
            '1': { active: true, lastNotifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }
        });
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'healthcheck.offline.state', value: offlineState } as any);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: true, message: 'OK' })
        });

        await service.performHealthCheck();

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'connection_online',
        }));
    });

    it('should skip offline notification when healthNotificationsDisabled is set', async () => {
        const mockAdapters = [
            {
                id: '1', name: 'Silent DB', adapterId: 'mysql', config: '{}',
                consecutiveFailures: 2, type: 'database',
                metadata: JSON.stringify({ healthNotificationsDisabled: true })
            }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
        });

        await service.performHealthCheck();

        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('should use custom reminder cooldown from notification config', async () => {
        mockGetNotificationConfig.mockResolvedValue({
            events: { 'connection.offline': { reminderIntervalHours: 1 } }
        });
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);

        // No assertion on behavior - just verify no crash when custom config is loaded
        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should fall back to default cooldown when getNotificationConfig throws', async () => {
        mockGetNotificationConfig.mockRejectedValue(new Error('config error'));
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should handle loadOfflineStates when stored JSON is invalid', async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue(
            { key: 'healthcheck.offline.state', value: 'not-valid-json' } as any
        );
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should handle log retention cleanup failure gracefully', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);
        prismaMock.healthCheckLog.deleteMany.mockRejectedValue(new Error('DB error'));

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should not re-send offline notification when still within cooldown', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 2, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        // State: active with notification sent 1 hour ago, cooldown 24h
        const offlineState = JSON.stringify({
            '1': { active: true, lastNotifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }
        });
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'healthcheck.offline.state', value: offlineState } as any);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
        });

        await service.performHealthCheck();

        // Should NOT re-notify (within 24h default cooldown)
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('should handle adapter.test() rejection - hits err callback in promise.then', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockRejectedValue(new Error('connection refused'))
        });

        await service.performHealthCheck();

        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ lastStatus: 'DEGRADED', consecutiveFailures: 1 })
        }));
    });

    it('should update reminderCooldownMs when notification config has correct event key with non-zero hours', async () => {
        mockGetNotificationConfig.mockResolvedValueOnce({
            events: { connection_offline: { reminderIntervalHours: 2 } }
        });
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
        // No assertion on notification behavior - just verify the code path is reached without crash
    });

    it('should handle saveOfflineStates failure gracefully when stateChanged is true', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 2, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        prismaMock.systemSetting.upsert.mockRejectedValue(new Error('DB write failed'));
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
        });

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should handle resolveAdapterConfig failure inside checkAdapter', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        (registry.get as any).mockReturnValue({ test: vi.fn() });
        vi.mocked(resolveAdapterConfig).mockRejectedValueOnce(new Error('decrypt error'));

        await service.performHealthCheck();

        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ lastStatus: 'DEGRADED', consecutiveFailures: 1 })
        }));
    });

    it('should handle prisma.$transaction failure gracefully', async () => {
        const mockAdapters = [
            { id: '1', name: 'DB 1', adapterId: 'mysql', config: '{}', consecutiveFailures: 0, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: true })
        });
        prismaMock.$transaction.mockRejectedValueOnce(new Error('DB transaction failed'));

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should handle notify failure for offline notification gracefully', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 2, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: false, message: 'refused' })
        });
        mockNotify.mockRejectedValueOnce(new Error('Notification service unavailable'));

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
        // State is still upserted even after notify failure
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalled();
    });

    it('should handle notify failure for recovery notification gracefully', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 5, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        const offlineState = JSON.stringify({
            '1': { active: true, lastNotifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }
        });
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'healthcheck.offline.state', value: offlineState } as any);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: true })
        });
        mockNotify.mockRejectedValueOnce(new Error('Recovery notification failed'));

        await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it('should calculate downtime without hours when recovery is within the same hour', async () => {
        const mockAdapters = [
            { id: '1', name: 'My DB', adapterId: 'mysql', config: '{}', consecutiveFailures: 5, type: 'database', metadata: null }
        ];
        prismaMock.adapterConfig.findMany.mockResolvedValue(mockAdapters as any);

        // Went offline only 30 minutes ago (less than 1 hour)
        const offlineState = JSON.stringify({
            '1': { active: true, lastNotifiedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
        });
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'healthcheck.offline.state', value: offlineState } as any);
        prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
        (registry.get as any).mockReturnValue({
            test: vi.fn().mockResolvedValue({ success: true })
        });

        await service.performHealthCheck();

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'connection_online',
            data: expect.objectContaining({ downtime: expect.stringMatching(/^\d+m$/) }),
        }));
    });
});
