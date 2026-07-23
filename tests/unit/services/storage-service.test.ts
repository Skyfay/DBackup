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

// Config resolver - default: parse the stored JSON config
const mockResolveAdapterConfig = vi.fn();
vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

// Temp dir
vi.mock('@/lib/temp-dir', () => ({
    getTempDir: () => '/tmp',
}));

// Node fs and stream mocks - create vi.fn() INSIDE the factory for reliable ESM binding
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

// ── Mock function imports (same vi.fn() instances that the service receives) ──
import { createReadStream as _mockCRS, createWriteStream as _mockCWS, promises as _mockFsP } from 'fs';
import { pipeline as _mockPipeline } from 'stream/promises';

// Convenience aliases that mirror the old fsMocks object structure
const fsMocks = {
    get createReadStream() { return _mockCRS as unknown as ReturnType<typeof vi.fn>; },
    get createWriteStream() { return _mockCWS as unknown as ReturnType<typeof vi.fn>; },
    get writeFile() { return (_mockFsP as any).writeFile as ReturnType<typeof vi.fn>; },
    get unlink() { return (_mockFsP as any).unlink as ReturnType<typeof vi.fn>; },
    get rename() { return (_mockFsP as any).rename as ReturnType<typeof vi.fn>; },
    get readFile() { return (_mockFsP as any).readFile as ReturnType<typeof vi.fn>; },
};
const mockPipeline = _mockPipeline as unknown as ReturnType<typeof vi.fn>;

// Encryption
const mockGetProfileMasterKey = vi.fn().mockResolvedValue(Buffer.alloc(32));vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: (...args: any[]) => mockGetProfileMasterKey(...args),
}));

const mockCreateDecryptionStream = vi.fn().mockReturnValue({});
vi.mock('@/lib/crypto/stream', () => ({
    createDecryptionStream: (...args: any[]) => mockCreateDecryptionStream(...args),
}));

// AdmZip
const mockAdmZipInstance = {
    addLocalFile: vi.fn(),
    writeZip: vi.fn(),
};
vi.mock('adm-zip', () => ({
    default: function() { return mockAdmZipInstance; },
}));

// Logger / Errors
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
        storageRole: 'DESTINATION',
        ...overrides,
    };
}

function makeAdapter(overrides?: Record<string, any>) {
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

describe('StorageService', () => {
    let service: StorageService;

    beforeEach(() => {
        service = new StorageService();
        vi.clearAllMocks();
        // Default: resolve config by parsing the stored JSON
        mockResolveAdapterConfig.mockImplementation((adapterConfig: any) =>
            Promise.resolve(JSON.parse(adapterConfig.config))
        );
        // storageListCache.upsert is a fire-and-forget cache write - must return a Promise
        prismaMock.storageListCache.upsert.mockResolvedValue({} as any);
        // Reset fs mocks to success
        fsMocks.writeFile.mockResolvedValue(undefined);
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.rename.mockResolvedValue(undefined);
        fsMocks.readFile.mockResolvedValue('{}');
        // Use PassThrough streams so the real pipeline completes cleanly
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });
        fsMocks.createWriteStream.mockImplementation(() => new PassThrough());
        mockPipeline.mockResolvedValue(undefined);
        mockGetProfileMasterKey.mockResolvedValue(Buffer.alloc(32));
        // Use PassThrough as decryption stream so real pipeline can complete
        mockCreateDecryptionStream.mockReturnValue(new PassThrough());
        mockAdmZipInstance.addLocalFile.mockReset();
        mockAdmZipInstance.writeZip.mockReset();
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
                metadata: null,
                lastHealthCheck: null,
                lastStatus: 'ONLINE',
                consecutiveFailures: 0,
                lastError: null,
                primaryCredentialId: null,
                sshCredentialId: null,
                defaultRetentionPolicyId: null,
                storageRole: 'DESTINATION',
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
                metadata: null,
                lastHealthCheck: null,
                lastStatus: 'ONLINE',
                consecutiveFailures: 0,
                lastError: null,
                primaryCredentialId: null,
                sshCredentialId: null,
                defaultRetentionPolicyId: null,
                storageRole: 'DESTINATION',
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
                metadata: null,
                lastHealthCheck: null,
                lastStatus: 'ONLINE',
                consecutiveFailures: 0,
                lastError: null,
                primaryCredentialId: null,
                sshCredentialId: null,
                defaultRetentionPolicyId: null,
                storageRole: 'DESTINATION',
            });

            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow("Storage adapter implementation 'unknown-adapter' not found in registry");
        });
    });

    describe('toggleLock', () => {
        it('should toggle lock from false to true', async () => {
            const metadata = { locked: false, jobName: 'TestJob' };
            const adapter = makeAdapter({
                read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
                upload: vi.fn().mockResolvedValue(undefined),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.toggleLock('conf-123', 'backup.sql');

            expect(result).toBe(true);
            expect(adapter.read).toHaveBeenCalledWith({ basePath: '/tmp/backups' }, 'backup.sql.meta.json');
            expect(adapter.upload).toHaveBeenCalled();
        });

        it('should toggle lock from true to false', async () => {
            const metadata = { locked: true };
            const adapter = makeAdapter({
                read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
                upload: vi.fn().mockResolvedValue(undefined),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.toggleLock('conf-123', 'backup.sql');

            expect(result).toBe(false);
        });

        it('should throw when storage config not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.toggleLock('missing', 'backup.sql'))
                .rejects.toThrow('Storage not found');
        });

        it('should throw when adapter does not support read', async () => {
            const adapter = makeAdapter({ read: undefined });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            await expect(service.toggleLock('conf-123', 'backup.sql'))
                .rejects.toThrow('Could not read metadata for this backup');
        });

        it('should silently ignore temp file cleanup error in toggleLock', async () => {
            const metadata = { locked: false };
            const adapter = makeAdapter({
                read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
                upload: vi.fn().mockResolvedValue(undefined),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);
            // Make the temp file unlink fail - should be silently swallowed
            fsMocks.unlink.mockRejectedValueOnce(new Error('unlink failed'));

            const result = await service.toggleLock('conf-123', 'backup.sql');

            expect(result).toBe(true);
        });
    });

    describe('listFiles', () => {
        it('should list files successfully given valid config', async () => {
            const mockFiles: FileInfo[] = [
                { name: 'backup.sql', path: '/backup.sql', size: 1024, lastModified: new Date() }
            ];
            const adapter = makeAdapter({ list: vi.fn().mockResolvedValue(mockFiles) });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFiles('conf-123');

            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'conf-123' } });
            expect(registry.get).toHaveBeenCalledWith('local-filesystem');
            expect(adapter.list).toHaveBeenCalledWith({ basePath: '/tmp/backups' }, '');
            expect(result).toEqual(mockFiles);
        });

        it('should throw error if config not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.listFiles('missing-id'))
                .rejects.toThrow('Storage configuration with ID missing-id not found');
        });

        it('should throw error if adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow('Adapter configuration conf-123 is not a storage adapter');
        });

        it('should throw error if adapter implementation is missing from registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ adapterId: 'unknown-adapter' }));
            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow("Storage adapter implementation 'unknown-adapter' not found in registry");
        });

        it('should throw when resolveAdapterConfig fails', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValueOnce(new Error('Bad decrypt'));

            await expect(service.listFiles('conf-123'))
                .rejects.toThrow('Failed to decrypt configuration for conf-123');
        });
    });

    describe('listFilesWithMetadata', () => {
        it('should return files with enriched metadata from sidecars', async () => {
            const mockFiles: FileInfo[] = [
                { name: 'backup.sql', path: 'backup.sql', size: 1024, lastModified: new Date() },
                { name: 'backup.sql.meta.json', path: 'backup.sql.meta.json', size: 100, lastModified: new Date() }
            ];
            const sidecarData = {
                jobName: 'SuperJob',
                sourceName: 'MyDB',
                sourceType: 'mysql',
                databases: { count: 5, names: [] }
            };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(mockFiles),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('backup.sql');
            expect(result[0].jobName).toBe('SuperJob');
            expect(result[0].dbInfo?.count).toBe(5);
        });

        it('should label a combined (DB + directory sources) archive using the combined metadata', async () => {
            const mockFiles: FileInfo[] = [
                { name: 'backup.tar', path: 'backup.tar', size: 1024, lastModified: new Date() },
                { name: 'backup.tar.meta.json', path: 'backup.tar.meta.json', size: 100, lastModified: new Date() }
            ];
            const sidecarData = {
                jobName: 'CombinedJob',
                sourceName: 'MyDB + 2 directory source(s)',
                sourceType: 'mysql',
                databases: { count: 2, names: [] },
                combined: { databases: 2, directorySources: 2 },
            };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(mockFiles),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].dbInfo).toEqual({ count: 2, label: '2 DBs + 2 Dirs' });
        });

        it('should label a directory-only combined archive without a misleading DB count', async () => {
            const mockFiles: FileInfo[] = [
                { name: 'backup.tar', path: 'backup.tar', size: 1024, lastModified: new Date() },
                { name: 'backup.tar.meta.json', path: 'backup.tar.meta.json', size: 100, lastModified: new Date() }
            ];
            const sidecarData = {
                jobName: 'DirOnlyJob',
                sourceName: '1 directory source(s)',
                sourceType: 'directory-only',
                databases: { count: 0, names: [] },
                combined: { databases: 0, directorySources: 1 },
            };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(mockFiles),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].dbInfo).toEqual({ count: 0, label: '1 Directory Source' });
        });

        it('should read compression and encryption from a v2 archive metadata block', async () => {
            // A seekable (v2) archive applies both per entry, so the top-level compression and
            // encryption fields are absent - the real state lives under `archive`. The explorer
            // must fall back to it, otherwise a GZIP-compressed encrypted file backup shows
            // neither in the listing.
            const mockFiles: FileInfo[] = [
                { name: 'backup.tar', path: 'backup.tar', size: 1024, lastModified: new Date() },
                { name: 'backup.tar.meta.json', path: 'backup.tar.meta.json', size: 100, lastModified: new Date() }
            ];
            const sidecarData = {
                jobName: 'FileBackup',
                sourceType: 'postgres',
                combined: { databases: 1, directorySources: 1 },
                // No top-level compression/encryption - only the archive block carries them.
                archive: { formatVersion: 2, indexFile: '.index', encrypted: true, profileId: 'prof-1', compression: 'GZIP', files: 130 },
            };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(mockFiles),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].compression).toBe('GZIP');
            expect(result[0].isEncrypted).toBe(true);
            expect(result[0].encryptionProfileId).toBe('prof-1');
        });

        it('should enrich file from execution metadata when no sidecar exists', async () => {
            const file: FileInfo = { name: 'backup.sql', path: 'backups/MyJob/backup.sql', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null), // no sidecar
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([
                {
                    path: 'backups/MyJob/backup.sql',
                    metadata: JSON.stringify({ jobName: 'MyJob', sourceName: 'MyDB', adapterId: 'mysql', label: 'Single DB', count: 1 }),
                },
            ] as any);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].jobName).toBe('MyJob');
            expect(result[0].sourceName).toBe('MyDB');
            expect(result[0].sourceType).toBe('mysql');
        });

        it('should use execution metadata label without returning early when no jobName', async () => {
            // execution meta has label but no jobName - should fall through to job/regex fallback
            const file: FileInfo = { name: 'backup.sql', path: 'MyJob/backup.sql', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            const job = { name: 'MyJob', source: { name: 'DB', type: 'mysql' } };
            prismaMock.job.findMany.mockResolvedValue([job] as any);
            prismaMock.execution.findMany.mockResolvedValue([
                {
                    path: 'MyJob/backup.sql',
                    metadata: JSON.stringify({ label: 'Single DB', count: 1 }),
                },
            ] as any);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            // Falls through to job fallback since no jobName in execution meta
            expect(result[0].jobName).toBe('MyJob');
        });

        it('should fall back to matching job when no sidecar or execution metadata', async () => {
            const file: FileInfo = { name: 'backup.sql', path: 'MyJob/backup.sql', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            const job = { name: 'MyJob', source: { name: 'PgDB', type: 'postgres' } };
            prismaMock.job.findMany.mockResolvedValue([job] as any);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].jobName).toBe('MyJob');
            expect(result[0].sourceName).toBe('PgDB');
            expect(result[0].sourceType).toBe('postgres');
        });

        it('should label config backup files via regex fallback', async () => {
            const file: FileInfo = { name: 'config_backup_2026.zip', path: 'config_backup_2026.zip', size: 512, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].jobName).toBe('Config Backup');
            expect(result[0].sourceType).toBe('SYSTEM');
        });

        it('should filter to SYSTEM files when typeFilter is SYSTEM', async () => {
            const files: FileInfo[] = [
                { name: 'config_backup_2026.zip', path: 'config_backup_2026.zip', size: 512, lastModified: new Date() },
                { name: 'backup.sql', path: 'MyJob/backup.sql', size: 1024, lastModified: new Date() },
            ];
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123', 'SYSTEM');

            expect(result.every(f => f.sourceType === 'SYSTEM')).toBe(true);
            expect(result.length).toBe(1);
        });

        it('should filter to non-SYSTEM files when typeFilter is BACKUP', async () => {
            const files: FileInfo[] = [
                { name: 'config_backup_2026.zip', path: 'config_backup_2026.zip', size: 512, lastModified: new Date() },
                { name: 'backup.sql', path: 'MyJob/backup.sql', size: 1024, lastModified: new Date() },
            ];
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123', 'BACKUP');

            expect(result.every(f => f.sourceType !== 'SYSTEM')).toBe(true);
            expect(result.length).toBe(1);
        });

        it('should throw when config not found in listFilesWithMetadata', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);
            await expect(service.listFilesWithMetadata('bad-id')).rejects.toThrow('not found');
        });

        it('should throw when adapter is not storage type in listFilesWithMetadata', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));
            await expect(service.listFilesWithMetadata('conf-123')).rejects.toThrow('not a storage adapter');
        });

        it('should throw when adapter implementation not found in listFilesWithMetadata', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(undefined as any);
            await expect(service.listFilesWithMetadata('conf-123')).rejects.toThrow('not found in registry');
        });

        it('should throw when resolveAdapterConfig fails in listFilesWithMetadata', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValueOnce(new Error('decrypt error'));
            await expect(service.listFilesWithMetadata('conf-123')).rejects.toThrow('Failed to decrypt');
        });

        it('should handle execution path starting with slash', async () => {
            const file: FileInfo = { name: 'backup.sql', path: '/backups/MyJob/backup.sql', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([
                {
                    path: '/backups/MyJob/backup.sql',
                    metadata: JSON.stringify({ jobName: 'MyJob', sourceName: 'DB', adapterId: 'mysql', label: 'Single DB', count: 1 }),
                },
            ] as any);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].jobName).toBe('MyJob');
        });

        it('should enrich config backup files from sidecar metadata', async () => {
            const files: FileInfo[] = [
                { name: 'config_backup_2026.zip', path: 'config_backup_2026.zip', size: 512, lastModified: new Date() },
                { name: 'config_backup_2026.zip.meta.json', path: 'config_backup_2026.zip.meta.json', size: 100, lastModified: new Date() },
            ];
            const sidecarData = { sourceType: 'SYSTEM', jobName: 'Config Backup', sourceName: 'System', databases: 0 };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue(files),
                read: vi.fn().mockResolvedValue(JSON.stringify(sidecarData)),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].dbInfo?.count).toBe(1);
            expect(result[0].dbInfo?.label).toBe('System Config');
        });

        it('should detect GZIP compression by .gz extension when no sidecar exists', async () => {
            const file: FileInfo = { name: 'backup.sql.gz', path: 'backup.sql.gz', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].compression).toBe('GZIP');
        });

        it('should detect BROTLI compression by .br extension when no sidecar exists', async () => {
            const file: FileInfo = { name: 'backup.sql.br', path: 'backup.sql.br', size: 1024, lastModified: new Date() };
            const adapter = makeAdapter({
                list: vi.fn().mockResolvedValue([file]),
                read: vi.fn().mockResolvedValue(null),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: '{}' }));
            prismaMock.job.findMany.mockResolvedValue([]);
            prismaMock.execution.findMany.mockResolvedValue([]);
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.listFilesWithMetadata('conf-123');

            expect(result[0].compression).toBe('BROTLI');
        });
    });

    describe('deleteFile', () => {
        it('should delete file and sidecar successfully', async () => {
            const adapter = makeAdapter({ delete: vi.fn().mockResolvedValue(true) });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.deleteFile('conf-123', 'test.sql');

            expect(adapter.delete).toHaveBeenCalledWith({ basePath: '/tmp/backups' }, 'test.sql');
            expect(result).toBe(true);
        });

        it('should throw when config not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.deleteFile('missing', 'test.sql'))
                .rejects.toThrow('Storage configuration with ID missing not found');
        });

        it('should throw when adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));

            await expect(service.deleteFile('conf-123', 'test.sql'))
                .rejects.toThrow('Adapter configuration conf-123 is not a storage adapter');
        });

        it('should throw when adapter not found in registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ adapterId: 'ghost' }));
            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.deleteFile('conf-123', 'test.sql'))
                .rejects.toThrow("Storage adapter implementation 'ghost' not found in registry");
        });

        it('should throw when config decrypt fails', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValueOnce(new Error('Bad key'));

            await expect(service.deleteFile('conf-123', 'test.sql'))
                .rejects.toThrow('Failed to decrypt configuration for conf-123');
        });

        it('deletes every sidecar alongside the backup', async () => {
            const adapter = makeAdapter({ delete: vi.fn().mockResolvedValue(true) });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            await service.deleteFile('conf-123', 'test.sql');

            expect(vi.mocked(adapter.delete).mock.calls.map((c) => c[1])).toEqual([
                'test.sql',
                'test.sql.meta.json',
                'test.sql.index',
            ]);
        });

        it('continues with the remaining sidecars when one deletion fails', async () => {
            // A missing sidecar is normal (older backups have no .index), so a failure
            // there must never abort the rest or fail the delete.
            const adapter = makeAdapter({
                delete: vi.fn().mockImplementation((_config: unknown, target: string) => {
                    if (target.endsWith('.meta.json')) throw new Error('Meta not found');
                    return Promise.resolve(true);
                }),
            });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.deleteFile('conf-123', 'test.sql');

            expect(result).toBe(true); // main delete succeeded
            expect(vi.mocked(adapter.delete).mock.calls.map((c) => c[1])).toContain('test.sql.index');
        });
    });

    describe('downloadFile', () => {
        it('should download file successfully (plain path)', async () => {
            const adapter = makeAdapter({ download: vi.fn().mockResolvedValue(true) });
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ config: JSON.stringify({ bucket: 'b' }) }));
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'remote.sql', '/local/path.sql');

            expect(adapter.download).toHaveBeenCalledWith({ bucket: 'b' }, 'remote.sql', '/local/path.sql');
            expect(result).toMatchObject({ success: true, isZip: false });
        });

        it('should throw when config not found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

            await expect(service.downloadFile('missing', 'remote.sql', '/local/path.sql'))
                .rejects.toThrow('Storage configuration with ID missing not found');
        });

        it('should throw when adapter type is not storage', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ type: 'database' }));

            await expect(service.downloadFile('conf-123', 'remote.sql', '/local/path.sql'))
                .rejects.toThrow('Adapter configuration conf-123 is not a storage adapter');
        });

        it('should throw when adapter not found in registry', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig({ adapterId: 'ghost' }));
            vi.mocked(registry.get).mockReturnValue(undefined);

            await expect(service.downloadFile('conf-123', 'remote.sql', '/local/path.sql'))
                .rejects.toThrow("Storage adapter implementation 'ghost' not found in registry");
        });

        it('should throw when config decrypt fails', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(makeAdapter());
            mockResolveAdapterConfig.mockRejectedValueOnce(new Error('Bad key'));

            await expect(service.downloadFile('conf-123', 'remote.sql', '/local/path.sql'))
                .rejects.toThrow('Failed to decrypt configuration for conf-123');
        });

        describe('decrypt=true', () => {
            it('should return {success: false} when initial download fails', async () => {
                const adapter = makeAdapter({ download: vi.fn().mockResolvedValue(false) });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'remote.sql', '/local/out.sql', true);

                expect(result).toMatchObject({ success: false });
            });

            it('should return success without decrypting when no meta or encryption params found', async () => {
                const adapter = makeAdapter({
                    download: vi.fn()
                        .mockResolvedValueOnce(true)   // main file
                        .mockResolvedValueOnce(false),  // meta file not found
                    read: vi.fn().mockResolvedValue(null), // read returns null
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'remote.sql', '/local/out.sql', true);

                expect(result).toMatchObject({ success: true, isZip: false });
                expect(mockGetProfileMasterKey).not.toHaveBeenCalled();
            });

            it('should decrypt file using standard encryption format', async () => {
                const meta = {
                    encryption: {
                        enabled: true,
                        profileId: 'profile-1',
                        iv: 'aabbccddeeff0011',
                        authTag: '0011223344556677',
                    },
                };
                const adapter = makeAdapter({
                    download: vi.fn().mockResolvedValue(true),
                    read: vi.fn().mockResolvedValue(JSON.stringify(meta)),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                expect(mockGetProfileMasterKey).toHaveBeenCalledWith('profile-1');
                expect(mockCreateDecryptionStream).toHaveBeenCalled();
                expect(fsMocks.unlink).toHaveBeenCalled();
                expect(fsMocks.rename).toHaveBeenCalled();
                expect(result).toMatchObject({ success: true });
            });

            it('should decrypt file using legacy flat encryption format', async () => {
                const meta = {
                    encryptionProfileId: 'profile-legacy',
                    iv: 'aabbccddeeff0011',
                    authTag: '0011223344556677',
                };
                const adapter = makeAdapter({
                    download: vi.fn().mockResolvedValue(true),
                    read: vi.fn().mockResolvedValue(JSON.stringify(meta)),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                expect(mockGetProfileMasterKey).toHaveBeenCalledWith('profile-legacy');
                expect(mockCreateDecryptionStream).toHaveBeenCalled();
                expect(result).toMatchObject({ success: true });
            });

            it('should fall back to downloading meta when adapter.read is not supported', async () => {
                const meta = { encryptionProfileId: 'p', iv: 'aabb', authTag: 'ccdd' };
                fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(meta));
                const adapter = makeAdapter({
                    download: vi.fn().mockResolvedValue(true),
                    read: undefined as any, // adapter does not support read
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                // meta was downloaded as a file and then read from disk
                expect(fsMocks.readFile).toHaveBeenCalled();
            });

            it('should throw "Decryption failed" when decryption setup throws', async () => {
                const meta = { encryptionProfileId: 'p', iv: 'aabb', authTag: 'ccdd' };
                const adapter = makeAdapter({
                    download: vi.fn().mockResolvedValue(true),
                    read: vi.fn().mockResolvedValue(JSON.stringify(meta)),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                mockGetProfileMasterKey.mockRejectedValueOnce(new Error('Key not found'));

                await expect(service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true))
                    .rejects.toThrow('ENCRYPTION_KEY_REQUIRED:p');
            });

            it('should fall through to download fallback when adapter.read throws', async () => {
                const meta = { encryptionProfileId: 'p', iv: 'aabbccddeeff0011', authTag: '0011223344556677' };
                const adapter = makeAdapter({
                    download: vi.fn()
                        .mockResolvedValueOnce(true)   // main file download
                        .mockResolvedValueOnce(true),  // meta file fallback download
                    read: vi.fn().mockRejectedValueOnce(new Error('read failed')),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(meta));

                const result = await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                expect(result).toMatchObject({ success: true });
            });

            it('should skip decryption when meta download fallback rejects', async () => {
                // adapter.read returns null, then meta download rejects → .catch(() => false) fires
                const adapter = makeAdapter({
                    download: vi.fn()
                        .mockResolvedValueOnce(true)   // main file
                        .mockRejectedValueOnce(new Error('meta not found')), // meta download rejects
                    read: vi.fn().mockResolvedValue(null),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                // No encryption params found → returns success without decrypting
                expect(result).toMatchObject({ success: true, isZip: false });
                expect(mockGetProfileMasterKey).not.toHaveBeenCalled();
            });

            it('should silently ignore temp meta unlink error after download fallback succeeds', async () => {
                // adapter.read returns null, meta download succeeds, unlink of temp rejects
                const meta = { encryptionProfileId: 'p', iv: 'aabbccddeeff0011', authTag: '0011223344556677' };
                const adapter = makeAdapter({
                    download: vi.fn()
                        .mockResolvedValueOnce(true)   // main file
                        .mockResolvedValueOnce(true),  // meta fallback download succeeds
                    read: vi.fn().mockResolvedValue(null),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(meta));
                // First unlink (temp meta cleanup) fails → .catch(()=>{}) swallows it
                // Subsequent unlinks (decryption cleanup) succeed (from beforeEach default)
                fsMocks.unlink.mockRejectedValueOnce(new Error('unlink failed'));

                const result = await service.downloadFile('conf-123', 'remote.enc', '/local/out.sql', true);

                expect(result).toMatchObject({ success: true });
            });
        });

        describe('.enc file (no decrypt)', () => {
            it('should bundle .enc and .meta.json into a ZIP', async () => {
                const adapter = makeAdapter({
                    download: vi.fn().mockResolvedValue(true),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'backup.enc', '/local/dest.zip');

                expect(mockAdmZipInstance.addLocalFile).toHaveBeenCalledTimes(2);
                expect(mockAdmZipInstance.writeZip).toHaveBeenCalledWith('/local/dest.zip');
                expect(result).toMatchObject({ success: true, isZip: true });
            });

            it('should return {success: false} when main .enc download fails', async () => {
                const adapter = makeAdapter({ download: vi.fn().mockResolvedValue(false) });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'backup.enc', '/local/dest');

                expect(result).toMatchObject({ success: false });
            });

            it('should rename main file without ZIP when no meta file found', async () => {
                const adapter = makeAdapter({
                    download: vi.fn()
                        .mockResolvedValueOnce(true)   // main .enc
                        .mockRejectedValueOnce(new Error('Not found')), // meta
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);

                const result = await service.downloadFile('conf-123', 'backup.enc', '/local/dest');

                expect(fsMocks.rename).toHaveBeenCalled();
                expect(result).toMatchObject({ success: true, isZip: false });
            });

            it('should fall back to rename when ZIP creation throws', async () => {
                const adapter = makeAdapter({ download: vi.fn().mockResolvedValue(true) });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                mockAdmZipInstance.writeZip.mockImplementation(() => { throw new Error('Zip fail'); });

                const result = await service.downloadFile('conf-123', 'backup.enc', '/local/dest');

                expect(fsMocks.rename).toHaveBeenCalled();
                expect(result).toMatchObject({ success: true, isZip: false });
            });

            it('should silently ignore temp cleanup errors in .enc finally block', async () => {
                const adapter = makeAdapter({ download: vi.fn().mockResolvedValue(true) });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                // Make all unlink calls fail - errors should be swallowed by catch {}
                fsMocks.unlink.mockRejectedValue(new Error('cleanup failed'));

                const result = await service.downloadFile('conf-123', 'backup.enc', '/local/dest');

                expect(result).toMatchObject({ success: true, isZip: true });
            });

            it('should clean up and rethrow when main download throws', async () => {
                const adapter = makeAdapter({
                    download: vi.fn().mockRejectedValue(new Error('Network error')),
                });
                prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
                vi.mocked(registry.get).mockReturnValue(adapter);
                // unlink also rejects so the .catch(()=>{}) lambda fires
                fsMocks.unlink.mockRejectedValue(new Error('unlink failed'));

                await expect(service.downloadFile('conf-123', 'backup.enc', '/local/dest'))
                    .rejects.toThrow('Network error');
            });
        });
    });
});

