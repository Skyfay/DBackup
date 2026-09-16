import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { runRestorePipeline } from '@/services/restore/pipeline';
import { registry } from '@/lib/core/registry';
import * as decomp from '@/lib/crypto/compression';
import * as tarUtils from '@/lib/adapters/database/common/tar-utils';
import * as abortModule from '@/lib/execution/abort';
import { PassThrough } from 'stream';
import type { RestoreInput } from '@/services/restore/types';

// Hoisted so the same vi.fn() instances land in both the mock factory and test assertions.
const fsMocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 2048 }),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
}));

// Hoist pipeline mock so the factory can reference it safely.
const mockPipeline = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// --- Module Mocks ---

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    const mockPromises = {
        readFile: fsMocks.readFile,
        unlink: fsMocks.unlink,
        stat: fsMocks.stat,
    };
    return {
        ...actual,
        default: { ...actual, promises: mockPromises },
        promises: mockPromises,
        createReadStream: fsMocks.createReadStream,
        createWriteStream: fsMocks.createWriteStream,
    };
});

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (adapter: any) => {
        try { return JSON.parse(adapter.config); } catch { return {}; }
    }),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: vi.fn().mockReturnValue('/tmp/dbackup-test'),
}));

vi.mock('stream/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('stream/promises')>();
    return { ...actual, pipeline: mockPipeline };
});

vi.mock('@/lib/crypto/stream', () => ({
    createDecryptionStream: vi.fn(),
}));

vi.mock('@/lib/crypto/compression', () => ({
    getDecompressionStream: vi.fn(),
}));

vi.mock('@/lib/adapters/database/common/tar-utils', () => ({
    isMultiDbTar: vi.fn().mockResolvedValue(false),
    readTarManifest: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/notifications/system-notification-service', () => ({
    notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/execution/abort', () => ({
    registerExecution: vi.fn(),
    unregisterExecution: vi.fn(),
}));

vi.mock('@/services/restore/smart-recovery', async () => {
    const { Transform } = await import('stream');
    return {
        resolveDecryptionKey: vi.fn(),
        Transform,
    };
});

vi.mock('@/lib/crypto/checksum', () => ({
    verifyFileChecksum: vi.fn().mockResolvedValue({ valid: true }),
}));

// --- Test Fixtures ---

const mockStorageConfig = {
    id: 'storage-1',
    type: 'storage',
    adapterId: 'local-fs',
    config: JSON.stringify({ basePath: '/tmp/backups' }),
    name: 'Local FS',
    createdAt: new Date(),
    updatedAt: new Date(),
};

const mockSourceConfig = {
    id: 'source-1',
    type: 'database',
    adapterId: 'postgres',
    config: JSON.stringify({ host: 'localhost', database: 'mydb' }),
    name: 'Postgres DB',
    createdAt: new Date(),
    updatedAt: new Date(),
};

function makeInput(overrides: Partial<RestoreInput> = {}): RestoreInput {
    return {
        storageConfigId: 'storage-1',
        file: 'backup.sql',
        targetSourceId: 'source-1',
        ...overrides,
    };
}

function makeStorageAdapter(overrides = {}) {
    return {
        download: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function makeDbAdapter(overrides = {}) {
    return {
        restore: vi.fn().mockResolvedValue({ success: true }),
        test: vi.fn().mockResolvedValue({ success: true, version: '14.0' }),
        ...overrides,
    };
}

// --- Tests ---

describe('runRestorePipeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.execution.update.mockResolvedValue({} as any);
        vi.mocked(abortModule.registerExecution).mockReturnValue(new AbortController());

        // Default fs behaviour: metadata file not found (graceful fallback),
        // streams that end immediately so real stream/promises.pipeline can complete.
        fsMocks.readFile.mockRejectedValue(
            Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
        );
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.stat.mockResolvedValue({ size: 2048 });
        fsMocks.createWriteStream.mockReturnValue(new PassThrough());
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null)); // end stream so pipeline can complete
            return pt;
        });

        // No decompression by default
        vi.mocked(decomp.getDecompressionStream).mockReturnValue(null);
    });

    it('marks execution Failed when storage config is not found', async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);

        await runRestorePipeline('exec-no-storage', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    it('marks execution Failed when storage implementation is missing in registry', async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);
        vi.mocked(registry.get).mockReturnValueOnce(undefined as any);

        await runRestorePipeline('exec-no-impl', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    it('marks execution Cancelled when the abort signal is pre-aborted', async () => {
        const abortedController = new AbortController();
        abortedController.abort();
        vi.mocked(abortModule.registerExecution).mockReturnValue(abortedController);

        // Trigger an error so the catch block is reached
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);

        await runRestorePipeline('exec-cancelled', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Cancelled' }) }),
        );
    });

    it('decompresses a GZIP backup when compression metadata is detected', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        // Provide GZIP metadata so the decompression branch is entered
        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({ compression: 'GZIP' }));
        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(new PassThrough() as any);

        await runRestorePipeline('exec-decompress', makeInput());

        // Primary assertion: the decompression path was entered with the correct type
        expect(decomp.getDecompressionStream).toHaveBeenCalledWith('GZIP');
        // Secondary: execution was updated (completed – success or failed depending on stream env)
        expect(prismaMock.execution.update).toHaveBeenCalled();
    });

    it('logs a warning but continues when version detection throws', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            test: vi.fn().mockRejectedValue(new Error('Connection refused')),
            restore: vi.fn().mockResolvedValue({ success: true }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-ver-fail', makeInput());

        // Version detection failure is non-fatal - execution still succeeds
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('overrides sqlite database path when targetDatabaseName is provided', async () => {
        const sqliteConfig = {
            ...mockSourceConfig,
            adapterId: 'sqlite',
            config: JSON.stringify({ path: '/data/mydb.sqlite' }),
        };
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = { restore: vi.fn().mockResolvedValue({ success: true }) };

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(sqliteConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-sqlite', makeInput({ targetDatabaseName: 'newdb' }));

        const restoredConfig = dbAdapter.restore.mock.calls[0][0];
        expect(restoredConfig.path).toBe('/data/newdb');
    });

    it('injects databaseMapping into the restore config', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        const mapping = { old_db: 'new_db' };
        await runRestorePipeline('exec-mapping', makeInput({ databaseMapping: mapping }));

        const restoredConfig = dbAdapter.restore.mock.calls[0][0];
        expect(restoredConfig.databaseMapping).toEqual(mapping);
    });

    it('injects privilegedAuth credentials into the restore config', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        const privilegedAuth = { user: 'admin', password: 'secret' };
        await runRestorePipeline('exec-priv', makeInput({ privilegedAuth }));

        const restoredConfig = dbAdapter.restore.mock.calls[0][0];
        expect(restoredConfig.privilegedAuth).toEqual(privilegedAuth);
    });

    it('logs the multi-DB TAR manifest when archive is detected', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        vi.mocked(tarUtils.isMultiDbTar).mockResolvedValueOnce(true);
        vi.mocked(tarUtils.readTarManifest).mockResolvedValueOnce({
            databases: [
                { name: 'shop', format: 'sql', size: 1024 },
                { name: 'analytics', format: 'sql', size: 2048 },
            ],
        } as any);

        await runRestorePipeline('exec-tar', makeInput());

        // Execution still completes successfully
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
        expect(tarUtils.isMultiDbTar).toHaveBeenCalled();
        expect(tarUtils.readTarManifest).toHaveBeenCalled();
    });

    it('continues when multi-DB TAR detection throws', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        vi.mocked(tarUtils.isMultiDbTar).mockRejectedValueOnce(new Error('tar read error'));

        await runRestorePipeline('exec-tar-err', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('marks execution Failed when restore adapter reports failure', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            restore: vi.fn().mockResolvedValue({ success: false, error: 'Syntax error in dump' }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-adapter-fail', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    it('marks execution Failed when download fails', async () => {
        const storageAdapter = makeStorageAdapter({
            download: vi.fn().mockResolvedValue(false),
        });
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-dl-fail', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });
});
