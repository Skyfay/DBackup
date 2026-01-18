import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { StorageService } from '@/services/storage-service';
import { registry } from '@/lib/core/registry';
import { StorageAdapter, FileInfo } from '@/lib/core/interfaces';

// Mock Crypto to simplify config parsing
vi.mock('@/lib/crypto', () => ({
    decryptConfig: (input: any) => input, // Passthrough
}));

// Mock the Registry
vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
    }
}));

describe('StorageService', () => {
    let service: StorageService;

    beforeEach(() => {
        service = new StorageService();
        vi.clearAllMocks();
    });

    describe('listFiles', () => {
        it('should list files successfully given valid config', async () => {
            // Arrange
            const mockFiles: FileInfo[] = [
                { name: 'backup.sql', path: '/backup.sql', size: 1024, lastModified: new Date() }
            ];

            const mockAdapterImplementation = {
                list: vi.fn().mockResolvedValue(mockFiles),
                id: 'local-filesystem',
                type: 'storage',
                name: 'Local',
                configSchema: {},
            } as unknown as StorageAdapter;

            const mockDbConfig = {
                id: 'conf-123',
                name: 'Local Backups',
                type: 'storage',
                adapterId: 'local-filesystem',
                config: JSON.stringify({ basePath: '/tmp/backups' }), // mock crypto passes this through
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Prisma Mock
            prismaMock.adapterConfig.findUnique.mockResolvedValue(mockDbConfig);

            // Registry Mock
            vi.mocked(registry.get).mockReturnValue(mockAdapterImplementation);

            // Act
            const result = await service.listFiles('conf-123');

            // Assert
            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'conf-123' } });
            expect(registry.get).toHaveBeenCalledWith('local-filesystem');
            expect(mockAdapterImplementation.list).toHaveBeenCalledWith({ basePath: '/tmp/backups' }, "");
            expect(result).toEqual(mockFiles);
        });

        it('should throw error if config not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.listFiles('missing-id'))
                .rejects.toThrow('Storage configuration with ID missing-id not found');
        });

        it('should throw error if adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue({
                id: 'db-conf',
                type: 'database', // Wrong type
                adapterId: 'postgres',
                config: '{}',
                name: 'DB',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(service.listFiles('db-conf'))
                .rejects.toThrow('Adapter configuration db-conf is not a storage adapter');
        });

        it('should throw error if adapter implementation is missing from registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue({
                id: 'conf-123',
                type: 'storage',
                adapterId: 'unknown-adapter',
                config: '{}',
                name: 'Unknown',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow("Storage adapter implementation 'unknown-adapter' not found in registry");
        });
    });

    describe('listFilesWithMetadata', () => {
         it('should return files with enriched metadata from sidecars', async () => {
            // Mock Data
             const mockFiles: FileInfo[] = [
                { name: 'backup.sql', path: 'backup.sql', size: 1024, lastModified: new Date() },
                { name: 'backup.sql.meta.json', path: 'backup.sql.meta.json', size: 100, lastModified: new Date() }
            ];

            const sidecarData = {
                jobName: "SuperJob",
                sourceName: "MyDB",
                sourceType: "mysql",
                databases: { count: 5, names: [] }
            };

            const mockAdapterImplementation = {
                list: vi.fn().mockResolvedValue(mockFiles),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
                id: 'local-filesystem',
            } as unknown as StorageAdapter;

            const mockDbConfig = {
                id: 'conf-123',
                type: 'storage',
                adapterId: 'local-filesystem',
                config: '{}',
                name: 'Local',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Prisma Mocks
            prismaMock.adapterConfig.findUnique.mockResolvedValue(mockDbConfig);
            prismaMock.job.findMany.mockResolvedValue([]); // No jobs for fallback
            prismaMock.execution.findMany.mockResolvedValue([]); // No executions for fallback

            vi.mocked(registry.get).mockReturnValue(mockAdapterImplementation);

            // Act
            const result = await service.listFilesWithMetadata('conf-123');

            // Assert
            expect(result.length).toBe(1); // Only backup, not meta file
            expect(result[0].name).toBe('backup.sql');
            expect(result[0].jobName).toBe('SuperJob');
            expect(result[0].dbInfo?.count).toBe(5);
         });
    });

    describe('deleteFile', () => {
         it('should delete file successfully', async () => {
             const mockAdapterImplementation = {
                delete: vi.fn().mockResolvedValue(true),
            } as unknown as StorageAdapter;

            const mockDbConfig = {
                id: 'conf-123',
                type: 'storage',
                adapterId: 'local-filesystem',
                config: JSON.stringify({ basePath: '/tmp' }),
                name: 'Local',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            prismaMock.adapterConfig.findUnique.mockResolvedValue(mockDbConfig);
            vi.mocked(registry.get).mockReturnValue(mockAdapterImplementation);

            const result = await service.deleteFile('conf-123', 'test.sql');

            expect(mockAdapterImplementation.delete).toHaveBeenCalledWith({ basePath: '/tmp' }, 'test.sql');
            expect(result).toBe(true);
         });
    });

    describe('downloadFile', () => {
        it('should download file successfully', async () => {
            const mockAdapterImplementation = {
               download: vi.fn().mockResolvedValue(true),
           } as unknown as StorageAdapter;

           const mockDbConfig = {
               id: 'conf-123',
               type: 'storage',
               adapterId: 's3',
               config: JSON.stringify({ bucket: 'b' }),
               name: 'S3',
               createdAt: new Date(),
               updatedAt: new Date(),
           };

           prismaMock.adapterConfig.findUnique.mockResolvedValue(mockDbConfig);
           vi.mocked(registry.get).mockReturnValue(mockAdapterImplementation);

           const result = await service.downloadFile('conf-123', 'remote.sql', '/local/path.sql');

           expect(mockAdapterImplementation.download).toHaveBeenCalledWith({ bucket: 'b' }, 'remote.sql', '/local/path.sql');
           expect(result).toBe(true);
        });
   });
});
