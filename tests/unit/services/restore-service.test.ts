import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { RestoreService } from '@/services/restore-service';
import { registry } from '@/lib/core/registry';
import { StorageAdapter, DatabaseAdapter } from '@/lib/core/interfaces';
import fs from 'fs';

// Mock Dependencies
vi.mock('@/lib/crypto', () => ({
    decryptConfig: (input: any) => input,
}));

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
    }
}));

// Mock adapters registration to assume it does nothing during test import
vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

describe('RestoreService', () => {
    let service: RestoreService;

    // Mock Configs
    const mockStorageConfig = {
        id: 'storage-1',
        type: 'storage',
        adapterId: 'local-fs',
        config: JSON.stringify({ basePath: '/tmp/backups' }),
        name: 'Local',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockSourceConfig = {
        id: 'source-1',
        type: 'database',
        adapterId: 'postgres',
        config: JSON.stringify({ host: 'localhost' }),
        name: 'PG',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        service = new RestoreService();
        vi.clearAllMocks();

        // Spy on FS methods instead of full module mock to avoid import issues
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    });

    it('should execute full restore flow successfully', async () => {
        // Arrange
        const executionId = 'exec-123';
        const mockStorageAdapter = {
            download: vi.fn().mockResolvedValue(true),
        } as unknown as StorageAdapter;

        const mockDbAdapter = {
            restore: vi.fn().mockResolvedValue({ success: true, logs: ['Restored tables', 'Done'] }),
        } as unknown as DatabaseAdapter;

        // DB Mocks
        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
        prismaMock.execution.update.mockResolvedValue({} as any);
        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any) // 1. Storage
            .mockResolvedValueOnce(mockSourceConfig as any); // 2. Source

        // Registry Mocks
        vi.mocked(registry.get)
            .mockReturnValueOnce(mockStorageAdapter) // 1. Storage
            .mockReturnValueOnce(mockDbAdapter);     // 2. Source

        // Act
        const result = await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        });

        // Assert
        expect(prismaMock.execution.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'Restore', status: 'Running' })
        }));
        expect(mockStorageAdapter.download).toHaveBeenCalled();
        expect(mockDbAdapter.restore).toHaveBeenCalled();
        expect(prismaMock.execution.update).toHaveBeenCalledWith({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Success' })
        });
        expect(result.success).toBe(true);
        expect(fs.unlinkSync).toHaveBeenCalled(); // Cleanup
    });

    it('should handle download failure', async () => {
        const executionId = 'exec-fail-download';
        const mockStorageAdapter = {
            download: vi.fn().mockResolvedValue(false), // Fail
        } as unknown as StorageAdapter;

        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(mockStorageAdapter)
            .mockReturnValueOnce({} as any);

        await expect(service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        })).rejects.toThrow('Failed to download file from storage');

        expect(prismaMock.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Failed' })
        }));
    });

    it('should handle restore failure from adapter', async () => {
         const executionId = 'exec-fail-restore';
         const mockStorageAdapter = {
            download: vi.fn().mockResolvedValue(true),
        } as unknown as StorageAdapter;

        const mockDbAdapter = {
            restore: vi.fn().mockResolvedValue({ success: false, logs: ['Syntax error'], error: 'Oops' }),
        } as unknown as DatabaseAdapter;

        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any).mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get).mockReturnValueOnce(mockStorageAdapter).mockReturnValueOnce(mockDbAdapter);

        const result = await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Oops');
         expect(prismaMock.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Failed' })
        }));
        // Ensure cleanup still happens
        expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should throw if storage config missing', async () => {
        prismaMock.execution.create.mockResolvedValue({ id: '1' } as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(null); // Not found

        await expect(service.restore({
            storageConfigId: 'missing',
            file: 'f',
            targetSourceId: 's'
        })).rejects.toThrow('Storage adapter not found');
    });
});
