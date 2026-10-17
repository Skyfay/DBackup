import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { RestoreService } from '@/services/restore/restore-service';
import { registry } from '@/lib/core/registry';
import { StorageAdapter, DatabaseAdapter } from '@/lib/core/interfaces';
import * as encryptionService from '@/services/backup/encryption-service';
import * as cryptoStream from '@/lib/crypto/stream';
import fs from 'fs';
import { PassThrough } from 'stream';

// Mock Dependencies
vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: vi.fn(),
    getEncryptionProfiles: vi.fn(),
}));

vi.mock('@/lib/crypto/stream', () => ({
    createDecryptionStream: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
    decryptConfig: (input: any) => input,
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (adapter: any) => {
        try { return JSON.parse(adapter.config); } catch { return {}; }
    }),
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

const mockProcessQueue = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/execution/queue-manager', () => ({
    processQueue: () => mockProcessQueue(),
}));

describe('RestoreService', () => {
    let service: RestoreService;

    // Mock Configs
    const mockStorageConfig = {
        id: 'storage-1',
        type: 'storage',
        tenantId: 'tenant-1',
        adapterId: 'local-fs',
        config: JSON.stringify({ basePath: '/tmp/backups' }),
        name: 'Local',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockSourceConfig = {
        id: 'source-1',
        type: 'database',
        tenantId: 'tenant-1',
        adapterId: 'postgres',
        config: JSON.stringify({ host: 'localhost' }),
        name: 'PG',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    /**
     * The registry and the database answer by id, as they do at runtime: the destination's adapter
     * id gets the storage adapter, any other id the database adapter, and each connection its row.
     */
    function useAdapters(storageAdapter: unknown, dbAdapter: unknown) {
        vi.mocked(registry.get).mockImplementation(((id: string) => (id === mockStorageConfig.adapterId ? storageAdapter : dbAdapter)) as any);
        // @ts-expect-error -- Mock return type mismatch
        prismaMock.adapterConfig.findUnique.mockImplementation(async (args: any) => {
            if (args.where.id === mockStorageConfig.id) return mockStorageConfig as any;
            if (args.where.id === mockSourceConfig.id) return mockSourceConfig as any;
            return null;
        });
    }

    beforeEach(() => {
        service = new RestoreService();
        vi.clearAllMocks();
        vi.mocked(registry.get).mockReset();
        prismaMock.adapterConfig.findUnique.mockReset();
        // No destination of these tests is shared with other tenants.
        prismaMock.connectionShare.count.mockResolvedValue(0);

        // Spy on FS methods instead of full module mock to avoid import issues
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);
        vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    });

    // Waits for the background pipeline to complete. Uses 500ms to ensure CI runners
    // (which may be slower due to Docker/overlayfs I/O) have enough headroom.
    // Root cause of flakiness: real fs I/O must never happen inside unit tests -
    // always mock fs operations that touch the filesystem.
    const flushPromises = () => new Promise(resolve => setTimeout(resolve, 500));

    it('should execute full restore flow successfully', async () => {
        // Arrange
        const executionId = 'exec-123';
        const mockStorageAdapter = {
            // First call is the .meta.json sidecar check - return false so no real fs.readFile is triggered.
            // Second call is the actual backup file download.
            download: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
            read: vi.fn().mockResolvedValue(null),
        } as unknown as StorageAdapter;

        const mockDbAdapter = {
            restore: vi.fn().mockResolvedValue({ success: true, logs: ['Restored tables', 'Done'] }),
            prepareRestore: vi.fn().mockResolvedValue(true), // Add this
        } as unknown as DatabaseAdapter;

        // DB Mocks
        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
        prismaMock.execution.update.mockResolvedValue({} as any);

        useAdapters(mockStorageAdapter, mockDbAdapter);

        // Act
        const result = await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        });

        // Wait for background process
        await flushPromises();

        // Assert
        expect(result.success).toBe(true);
        expect(prismaMock.execution.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'Restore', status: 'Running' })
        }));
        expect(mockStorageAdapter.download).toHaveBeenCalled();
        expect(mockDbAdapter.restore).toHaveBeenCalled();
        expect(prismaMock.execution.update).toHaveBeenCalledWith({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Success' })
        });
        expect(fs.promises.unlink).toHaveBeenCalled(); // Cleanup
    });

    it('should handle download failure', async () => {
        const executionId = 'exec-fail-download';
        const mockStorageAdapter = {
            download: vi.fn().mockResolvedValue(false), // Fail
        } as unknown as StorageAdapter;

        const mockDbAdapter = {} as any;

        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);

        useAdapters(mockStorageAdapter, mockDbAdapter);

        await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        });

        await flushPromises();

        expect(mockStorageAdapter.download).toHaveBeenCalled();
        expect(prismaMock.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Failed' })
        }));
    });

    it('should handle restore failure from adapter', async () => {
         const executionId = 'exec-fail-restore';
         const mockStorageAdapter = {
            // First call is the .meta.json sidecar check - return false so no real fs.readFile is triggered.
            // Second call is the actual backup file download.
            download: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
            read: vi.fn().mockResolvedValue(null),
        } as unknown as StorageAdapter;

        const mockDbAdapter = {
            restore: vi.fn().mockResolvedValue({ success: false, logs: ['Syntax error'], error: 'Oops' }),
            prepareRestore: vi.fn().mockResolvedValue(true),
        } as unknown as DatabaseAdapter;

        prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);

        useAdapters(mockStorageAdapter, mockDbAdapter);

        const result = await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql',
            targetSourceId: 'source-1'
        });

        await flushPromises();

        // The public method returns success (queued)
        expect(result.success).toBe(true);

        // The background process should mark it failed
        expect(prismaMock.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Failed' })
        }));

        // Ensure cleanup still happens
        expect(fs.promises.unlink).toHaveBeenCalled();
    });

    it('should throw if target source missing (Pre-flight check)', async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(null); // Not found

        await expect(service.restore({
            storageConfigId: 'storage-1',
            file: 'f',
            targetSourceId: 'missing-source'
        })).rejects.toThrow('Target source not found');
    });

    describe('Version Compatibility Guard', () => {
        const mockStorage = {
            read: vi.fn(),
            download: vi.fn(),
        };
        const mockDb = {
            test: vi.fn(),
            restore: vi.fn(),
        };

        beforeEach(() => {
            (registry.get as any).mockImplementation((id: string) => {
                if (id === 'local-fs') return mockStorage;
                if (id === 'postgres') return mockDb;
                return undefined;
            });

            // @ts-expect-error -- Mock return type mismatch
            prismaMock.adapterConfig.findUnique.mockImplementation(async (args: any) => {
                if (args.where.id === 'storage-1') return mockStorageConfig as any;
                if (args.where.id === 'source-1') return mockSourceConfig as any;
                return null;
            });
        });

        it('should throw error when restoring a newer version backup to an older server', async () => {
             // Mock Metadata: Version 15.0
             mockStorage.read.mockResolvedValue(JSON.stringify({
                engineVersion: '15.0',
                dbs: ['mydb']
            }));

            // Mock Target Server: Version 14.0
            mockDb.test.mockResolvedValue({
                success: true,
                version: '14.0'
            });

            const input = {
                storageConfigId: 'storage-1',
                file: 'backup.sql',
                targetSourceId: 'source-1',
            };

            await expect(service.restore(input)).rejects.toThrow('newer database version (15.0) on an older server (14.0)');
        });

        it('should allow restoring older version backup to newer server', async () => {
            // Mock Metadata: Version 13.0
            mockStorage.read.mockResolvedValue(JSON.stringify({
               engineVersion: '13.0',
               dbs: ['mydb']
           }));

           // Mock Target Server: Version 14.0
           mockDb.test.mockResolvedValue({
               success: true,
               version: '14.0'
           });

           // Also need to allow execute creation for success path
           prismaMock.execution.create.mockResolvedValue({ id: 'exec-success' } as any);
           // RestoreProcess runs in background, so we just check the sync part returns success.

           const result = await service.restore({
               storageConfigId: 'storage-1',
               file: 'backup.sql',
               targetSourceId: 'source-1',
           });

           expect(result.success).toBe(true);
       });
    });

    it('should use Smart Recovery when original profile is missing', async () => {
        // 1. Setup Encrypted Metadata
        const metaContent = JSON.stringify({
            encryption: { enabled: true, profileId: 'lost-id', iv: '00', authTag: '00' },
            compression: 'NONE'
        });

        // 2. Mocks
        // Storage Adapter: download writes real files so createReadStream/pipeline work
        const mockStorageAdapter = {
            download: vi.fn().mockImplementation((_config: unknown, remote: string, local: string) => {
                if (remote.endsWith('.meta.json')) {
                    fs.writeFileSync(local, metaContent);
                } else {
                    fs.writeFileSync(local, 'CREATE TABLE valid_sql (id int); -- SQL content');
                }
                return Promise.resolve(true);
            }),
            read: vi.fn().mockResolvedValue(metaContent),
        } as unknown as StorageAdapter;

        // DB Adapter
        const mockDbAdapter = {
            restore: vi.fn().mockResolvedValue({ success: true }),
            prepareRestore: vi.fn().mockResolvedValue(true),
            test: vi.fn().mockResolvedValue({ success: true, version: '1.0' }),
        } as unknown as DatabaseAdapter;

        // Registry
        vi.mocked(registry.get).mockImplementation((id) => {
            if (id === 'postgres') return mockDbAdapter;
            return mockStorageAdapter;
        });

        // DB Configs
        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockSourceConfig as any)
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        prismaMock.execution.create.mockResolvedValue({ id: 'smart-rec-exec' } as any);
        prismaMock.execution.update.mockResolvedValue({} as any);

        // --- SMART RECOVERY MOCKS ---

        // 1. Encryption Service: Fail first, then succeed with fallback
        const fallbackProfile = { id: 'fallback-id', name: 'Fallback', secretKey: 'enc' };

        vi.mocked(encryptionService.getProfileMasterKey)
            .mockRejectedValueOnce(new Error('Profile not found')) // Original ID fails
            .mockResolvedValueOnce(Buffer.alloc(32, 'a'));         // Fallback Key

        vi.mocked(encryptionService.getEncryptionProfiles)
            .mockResolvedValue([fallbackProfile as any]);

        // 2. Crypto Stream: Return plain PassThrough (data flows through for heuristic check + pipeline)
        vi.mocked(cryptoStream.createDecryptionStream).mockImplementation(() => {
            return new PassThrough() as any;
        });

        // Act
        await service.restore({
            storageConfigId: 'storage-1',
            file: 'backup.sql.enc',
            targetSourceId: 'source-1'
        });

        // Wait for background process (Smart Recovery involves many async steps + real file I/O)
        await new Promise(resolve => setTimeout(resolve, 500));

        // Assert
        // 1. Verify it tried to fetch the lost profile
        expect(encryptionService.getProfileMasterKey).toHaveBeenCalledWith('lost-id');

        // 2. Verify it fetched all profiles for fallback
        expect(encryptionService.getEncryptionProfiles).toHaveBeenCalled();

        // 3. Verify it tried the fallback key
        expect(encryptionService.getProfileMasterKey).toHaveBeenCalledWith('fallback-id');

        // 4. Verify execution was updated (background process completed)
        const updateCalls = prismaMock.execution.update.mock.calls;
        const lastCall = updateCalls[updateCalls.length - 1];
        expect(lastCall).toBeTruthy();
    });

    describe('Queue trigger after restore (#95)', () => {
        it('should call processQueue after a successful restore so pending backup jobs are unblocked', async () => {
            const executionId = 'exec-queue-trigger';
            const mockStorageAdapter = {
                download: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
                read: vi.fn().mockResolvedValue(null),
            } as unknown as StorageAdapter;

            const mockDbAdapter = {
                restore: vi.fn().mockResolvedValue({ success: true, logs: [] }),
                prepareRestore: vi.fn().mockResolvedValue(true),
            } as unknown as DatabaseAdapter;

            prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
            prismaMock.execution.update.mockResolvedValue({} as any);

            useAdapters(mockStorageAdapter, mockDbAdapter);

            await service.restore({
                storageConfigId: 'storage-1',
                file: 'backup.sql',
                targetSourceId: 'source-1',
            });

            await flushPromises();

            expect(mockProcessQueue).toHaveBeenCalled();
        });

        it('should call processQueue even when restore fails so pending backup jobs are not blocked', async () => {
            const executionId = 'exec-queue-trigger-fail';
            const mockStorageAdapter = {
                download: vi.fn().mockResolvedValue(false), // triggers immediate failure
            } as unknown as StorageAdapter;

            prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
            prismaMock.execution.update.mockResolvedValue({} as any);

            useAdapters(mockStorageAdapter, {});

            await service.restore({
                storageConfigId: 'storage-1',
                file: 'backup.sql',
                targetSourceId: 'source-1',
            });

            await flushPromises();

            expect(mockProcessQueue).toHaveBeenCalled();
        });
    });
});
