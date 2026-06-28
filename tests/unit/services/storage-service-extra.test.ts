import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { StorageService } from '@/services/storage/storage-service';
import { registry } from '@/lib/core/registry';
import { StorageAdapter, FileInfo } from '@/lib/core/interfaces';

// ── Module Mocks ───────────────────────────────────────────────

vi.mock('@/lib/crypto', () => ({
    decryptConfig: (input: any) => input,
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

const mockResolveAdapterConfig = vi.fn();
vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: () => '/tmp',
}));

vi.mock('fs', async () => {
    const createReadStream = vi.fn();
    const createWriteStream = vi.fn();
    const promises = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue('{}'),
    };
    return {
        createReadStream,
        createWriteStream,
        promises,
        default: { createReadStream, createWriteStream, promises },
    };
});

vi.mock('stream/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('stream/promises')>();
    return { ...actual, pipeline: vi.fn().mockResolvedValue(undefined) };
});

import { createReadStream as _mockCRS, createWriteStream as _mockCWS, promises as _mockFsP } from 'fs';
import { pipeline as _mockPipeline } from 'stream/promises';

const fsMocks = {
    get createReadStream() { return _mockCRS as unknown as ReturnType<typeof vi.fn>; },
    get createWriteStream() { return _mockCWS as unknown as ReturnType<typeof vi.fn>; },
    get writeFile() { return (_mockFsP as any).writeFile as ReturnType<typeof vi.fn>; },
    get unlink() { return (_mockFsP as any).unlink as ReturnType<typeof vi.fn>; },
    get rename() { return (_mockFsP as any).rename as ReturnType<typeof vi.fn>; },
    get readFile() { return (_mockFsP as any).readFile as ReturnType<typeof vi.fn>; },
};
const mockPipeline = _mockPipeline as unknown as ReturnType<typeof vi.fn>;

const mockGetProfileMasterKey = vi.fn().mockResolvedValue(Buffer.alloc(32));
vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: (...args: any[]) => mockGetProfileMasterKey(...args),
}));

vi.mock('@/services/restore/smart-recovery', () => ({
    resolveDecryptionKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
}));

const mockCreateDecryptionStream = vi.fn().mockReturnValue({});
vi.mock('@/lib/crypto/stream', () => ({
    createDecryptionStream: (...args: any[]) => mockCreateDecryptionStream(...args),
}));

const mockAdmZipInstance = {
    addLocalFile: vi.fn(),
    writeZip: vi.fn(),
};
vi.mock('adm-zip', () => ({
    default: function() { return mockAdmZipInstance; },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));
vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e: any) => e),
}));

// ── Helpers ────────────────────────────────────────────────────

function makeDbConfig(overrides?: Record<string, any>) {
    return {
        id: 'conf-123',
        name: 'Test Storage',
        type: 'storage',
        adapterId: 'local-filesystem',
        config: JSON.stringify({ basePath: '/tmp/backups' }),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: null,
        lastHealthCheck: null,
        lastStatus: 'ONLINE',
        consecutiveFailures: 0,
        lastError: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        defaultRetentionPolicyId: null,
        ...overrides,
    };
}

function makeAdapter(overrides?: Record<string, any>): StorageAdapter {
    return {
        id: 'local-filesystem',
        type: 'storage',
        name: 'Local',
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
        download: vi.fn().mockResolvedValue(true),
        upload: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(null),
        ...overrides,
    } as unknown as StorageAdapter;
}

// ── Tests ──────────────────────────────────────────────────────

describe('StorageService - extra coverage', () => {
    let service: StorageService;

    beforeEach(() => {
        service = new StorageService();
        vi.clearAllMocks();
        mockResolveAdapterConfig.mockImplementation((adapterConfig: any) =>
            Promise.resolve(JSON.parse(adapterConfig.config))
        );
        prismaMock.storageListCache.upsert.mockResolvedValue({} as any);
        fsMocks.writeFile.mockResolvedValue(undefined);
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.rename.mockResolvedValue(undefined);
        fsMocks.readFile.mockResolvedValue('{}');
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });
        fsMocks.createWriteStream.mockImplementation(() => new PassThrough());
        mockPipeline.mockResolvedValue(undefined);
        mockGetProfileMasterKey.mockResolvedValue(Buffer.alloc(32));
        mockCreateDecryptionStream.mockReturnValue(new PassThrough());
        mockAdmZipInstance.addLocalFile.mockReset();
        mockAdmZipInstance.writeZip.mockReset();
    });

    // ===== listFiles - error paths =====

    describe('listFiles - error paths', () => {
        it('throws when config is not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.listFiles('missing-id'))
                .rejects.toThrow('Storage configuration with ID missing-id not found');
        });

        it('throws when adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow('Adapter configuration conf-123 is not a storage adapter');
        });

        it('throws when adapter not found in registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ adapterId: 'unknown' }));
            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow("Storage adapter implementation 'unknown' not found in registry");
        });

        it('throws when resolveAdapterConfig fails', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValue(new Error('Decryption error'));

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow('Failed to decrypt configuration for conf-123: Decryption error');
        });
    });

    // ===== deleteFile - error paths =====

    describe('deleteFile - error paths', () => {
        it('throws when storage config is not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.deleteFile('missing-id', 'backup.sql'))
                .rejects.toThrow('Storage configuration with ID missing-id not found');
        });

        it('throws when adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));

            await expect(service.deleteFile('conf-123', 'backup.sql'))
                .rejects.toThrow('Adapter configuration conf-123 is not a storage adapter');
        });

        it('throws when adapter is missing from registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ adapterId: 'ghost' }));
            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.deleteFile('conf-123', 'backup.sql'))
                .rejects.toThrow("Storage adapter implementation 'ghost' not found in registry");
        });

        it('throws when resolveAdapterConfig fails', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValue(new Error('Bad key'));

            await expect(service.deleteFile('conf-123', 'backup.sql'))
                .rejects.toThrow('Failed to decrypt configuration for conf-123: Bad key');
        });

        it('returns true and silently swallows meta deletion failure', async () => {
            const adapter = makeAdapter({
                delete: vi.fn()
                    .mockResolvedValueOnce(true)   // main file deleted
                    .mockRejectedValueOnce(new Error('meta not found')), // meta deletion fails
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);
            prismaMock.storageListCache.findUnique.mockResolvedValue(null);

            const result = await service.deleteFile('conf-123', 'backup.sql');

            expect(result).toBe(true);
        });

        it('returns false when main delete returns false', async () => {
            const adapter = makeAdapter({
                delete: vi.fn().mockResolvedValue(false),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);
            prismaMock.storageListCache.findUnique.mockResolvedValue(null);

            const result = await service.deleteFile('conf-123', 'backup.sql');

            expect(result).toBe(false);
        });

        it('invalidates the cache entry for the deleted file', async () => {
            const adapter = makeAdapter({ delete: vi.fn().mockResolvedValue(true) });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);
            prismaMock.storageListCache.findUnique.mockResolvedValue({
                adapterConfigId: 'conf-123',
                filesJson: JSON.stringify([
                    { name: 'backup.sql', path: 'backup.sql', size: 100, lastModified: new Date() },
                ]),
                cachedAt: new Date(),
            } as any);
            prismaMock.storageListCache.update.mockResolvedValue({} as any);

            await service.deleteFile('conf-123', 'backup.sql');

            expect(prismaMock.storageListCache.update).toHaveBeenCalled();
        });
    });

    // ===== enrichSingleFile - databases field variations =====

    describe('enrichSingleFile via listFilesWithMetadata - databases field formats', () => {
        beforeEach(() => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
        });

        function setupAdapterWithMeta(meta: Record<string, any>) {
            const files: FileInfo[] = [
                { name: 'backup.sql', path: 'backup.sql', size: 512, lastModified: new Date() },
                { name: 'backup.sql.meta.json', path: 'backup.sql.meta.json', size: 50, lastModified: new Date() },
            ];
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(JSON.stringify(meta)),
            });
            vi.mocked(registry.get).mockReturnValue(adapter);
        }

        it('counts databases when sidecar has databases as object with count field', async () => {
            setupAdapterWithMeta({
                jobName: 'MyJob',
                sourceName: 'mysql-prod',
                sourceType: 'mysql',
                databases: { count: 3 },
            });

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].dbInfo?.count).toBe(3);
            expect(results[0].dbInfo?.label).toBe('3 DBs');
        });

        it('counts databases when sidecar has databases as a number', async () => {
            setupAdapterWithMeta({
                jobName: 'MyJob',
                sourceName: 'mysql-prod',
                sourceType: 'mysql',
                databases: 1,
            });

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].dbInfo?.count).toBe(1);
            expect(results[0].dbInfo?.label).toBe('Single DB');
        });

        it('uses Unknown label when databases count is 0', async () => {
            setupAdapterWithMeta({
                jobName: 'MyJob',
                sourceName: 'mysql-prod',
                sourceType: 'mysql',
                databases: 0,
            });

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].dbInfo?.label).toBe('Unknown');
        });

        it('marks file as encrypted when sidecar has encryption.enabled', async () => {
            setupAdapterWithMeta({
                jobName: 'MyJob',
                sourceName: 'postgres',
                sourceType: 'postgres',
                databases: { count: 1 },
                encryption: { enabled: true, profileId: 'prof-abc', iv: 'aa', authTag: 'bb' },
            });

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].isEncrypted).toBe(true);
            expect(results[0].encryptionProfileId).toBe('prof-abc');
        });

        it('handles config backup type from sourceType SYSTEM', async () => {
            setupAdapterWithMeta({
                jobName: 'Config Backup',
                sourceType: 'SYSTEM',
                databases: 0,
            });

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].dbInfo?.label).toBe('System Config');
            expect(results[0].dbInfo?.count).toBe(1);
        });

        it('returns file with no sidecar enriched from filename heuristic', async () => {
            const files: FileInfo[] = [
                { name: 'MyJob_2026-06-01_00-00-00.sql.gz', path: 'MyJob_2026-06-01_00-00-00.sql.gz', size: 1024, lastModified: new Date() },
            ];
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(null),
            });
            vi.mocked(registry.get).mockReturnValue(adapter);

            const results = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(results[0].jobName).toBe('MyJob');
            expect(results[0].compression).toBe('GZIP');
        });
    });

    // ===== listFilesWithMetadata - cache paths =====

    describe('listFilesWithMetadata - cache paths', () => {
        it('returns cached results when cache is fresh', async () => {
            const cachedFiles = [
                { name: 'cached.sql', path: 'cached.sql', size: 100, lastModified: new Date().toISOString() },
            ];
            prismaMock.storageListCache.findUnique.mockResolvedValue({
                adapterConfigId: 'conf-123',
                filesJson: JSON.stringify(cachedFiles),
                cachedAt: new Date(), // fresh
            } as any);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(prismaMock.adapterConfig.findUnique).not.toHaveBeenCalled();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('cached.sql');
        });

        it('triggers background reconcile when cache is stale but still returns cached data', async () => {
            const staleDate = new Date(Date.now() - 3 * 3_600_000); // 3 hours ago
            const cachedFiles = [
                { name: 'old.sql', path: 'old.sql', size: 50, lastModified: new Date().toISOString() },
            ];
            prismaMock.storageListCache.findUnique.mockResolvedValue({
                adapterConfigId: 'conf-123',
                filesJson: JSON.stringify(cachedFiles),
                cachedAt: staleDate,
            } as any);

            const reconcileSpy = vi.spyOn(service, 'reconcileStorageListCache').mockResolvedValue();

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result).toHaveLength(1);
            // Background reconcile should have been triggered.
            expect(reconcileSpy).toHaveBeenCalledWith('conf-123');
        });

        it('bypasses cache when bypassCache=true', async () => {
            prismaMock.storageListCache.findUnique.mockResolvedValue({
                adapterConfigId: 'conf-123',
                filesJson: JSON.stringify([{ name: 'cached.sql', path: 'cached.sql', size: 100, lastModified: new Date().toISOString() }]),
                cachedAt: new Date(),
            } as any);

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            const adapter = makeAdapter({ list: vi.fn().mockResolvedValue([]) });
            vi.mocked(registry.get).mockReturnValue(adapter);
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);

            const result = await service.listFilesWithMetadata('conf-123', undefined, true);

            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalled();
            expect(result).toHaveLength(0);
        });

        it('throws when adapter config not found on cache miss', async () => {
            prismaMock.storageListCache.findUnique.mockResolvedValue(null);
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.listFilesWithMetadata('conf-missing', undefined, true))
                .rejects.toThrow('Storage configuration with ID conf-missing not found');
        });
    });

    // ===== cache invalidation =====

    describe('invalidateStorageListCache', () => {
        it('deletes all cache entries for the given adapter config id', async () => {
            prismaMock.storageListCache.deleteMany.mockResolvedValue({ count: 1 } as any);

            await service.invalidateStorageListCache('conf-123');

            expect(prismaMock.storageListCache.deleteMany).toHaveBeenCalledWith({
                where: { adapterConfigId: 'conf-123' },
            });
        });
    });

    // ===== applyTypeFilter (via listFilesWithMetadata) =====

    describe('applyTypeFilter via listFilesWithMetadata', () => {
        beforeEach(() => {
            const files: FileInfo[] = [
                { name: 'backup.sql', path: 'backup.sql', size: 100, lastModified: new Date() },
                { name: 'config_backup.tar.gz', path: 'config_backup.tar.gz', size: 200, lastModified: new Date() },
            ];
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(null),
            });
            vi.mocked(registry.get).mockReturnValue(adapter);
        });

        it('filters to SYSTEM files only when typeFilter is SYSTEM', async () => {
            const results = await service.listFilesWithMetadata('conf-123', 'SYSTEM', true);
            // config_backup_ prefix triggers SYSTEM sourceType.
            expect(results.every((f) => f.sourceType === 'SYSTEM')).toBe(true);
        });

        it('filters to non-SYSTEM files when typeFilter is BACKUP', async () => {
            const results = await service.listFilesWithMetadata('conf-123', 'BACKUP', true);
            expect(results.every((f) => f.sourceType !== 'SYSTEM')).toBe(true);
        });

        it('returns all files when typeFilter is undefined', async () => {
            const results = await service.listFilesWithMetadata('conf-123', undefined, true);
            expect(results.length).toBeGreaterThan(0);
        });
    });
});
