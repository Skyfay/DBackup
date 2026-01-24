import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { HealthCheckService } from '@/services/healthcheck-service';
import { registry } from '@/lib/core/registry';

// Mock registry and crypto
vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn()
    }
}));

vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((config) => config)
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

    it('should clean up old logs', async () => {
        // Arrange
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);
        prismaMock.healthCheckLog.deleteMany.mockResolvedValue({ count: 10 } as any);

        // Act
        await service.performHealthCheck();

        // Assert
        expect(prismaMock.healthCheckLog.deleteMany).toHaveBeenCalled();
    });
});
