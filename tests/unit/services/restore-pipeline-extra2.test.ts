/**
 * Extra coverage for restore/pipeline.ts targeting:
 *   - Line 413: version detection returns success=false (no version logged)
 *   - Lines 468-470: non-SQLite databaseMapping path (dbConf.databaseMapping assigned)
 *   - Lines 500-514: successful restore fires RESTORE_COMPLETE notification + processQueue
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { runRestorePipeline } from '@/services/restore/pipeline';
import { registry } from '@/lib/core/registry';
import * as decomp from '@/lib/crypto/compression';
import * as abortModule from '@/lib/execution/abort';
import * as notifyModule from '@/services/notifications/system-notification-service';
import * as queueModule from '@/lib/execution/queue-manager';
import { PassThrough } from 'stream';
import type { RestoreInput } from '@/services/restore/types';

// --- Hoisted mocks ---

const fsMocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
}));

const mockPipeline = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// --- Module mocks ---

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

vi.mock('@/lib/execution/queue-manager', () => ({
    processQueue: vi.fn().mockResolvedValue(undefined),
}));

// --- Fixtures ---

const mockStorageConfig = {
    id: 'storage-1',
    type: 'storage',
    adapterId: 'local-fs',
    config: JSON.stringify({ basePath: '/tmp/backups' }),
    name: 'Local FS',
    createdAt: new Date(),
    updatedAt: new Date(),
};

const mockPostgresConfig = {
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

describe('runRestorePipeline (extra coverage 2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        prismaMock.execution.update.mockResolvedValue({} as any);
        vi.mocked(abortModule.registerExecution).mockReturnValue(new AbortController());

        // Default: metadata not found.
        fsMocks.readFile.mockRejectedValue(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.stat.mockResolvedValue({ size: 1024 });
        fsMocks.createWriteStream.mockReturnValue(new PassThrough());
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });

        vi.mocked(decomp.getDecompressionStream).mockReturnValue(null);
    });

    // -------------------------------------------------------------------------
    // Line 413: test() returns success=true but no version field
    // -------------------------------------------------------------------------

    it('logs "using default binary" warning when test() succeeds but returns no version (line 413)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            // success: true but version is undefined/empty
            test: vi.fn().mockResolvedValue({ success: true, version: undefined }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-no-version', makeInput());

        // Pipeline should still succeed.
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
        // dbConf.detectedVersion should not be set because the else branch was taken.
        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(restoredConfig.detectedVersion).toBeUndefined();
    });

    it('logs "using default binary" warning when test() returns success=false (line 413)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            test: vi.fn().mockResolvedValue({ success: false }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-test-fail', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    // -------------------------------------------------------------------------
    // Lines 433-448: databaseMapping for non-SQLite adapter (line 434 path)
    // -------------------------------------------------------------------------

    it('assigns databaseMapping to dbConf for non-SQLite adapters without path rewrite (line 434)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        const mapping = [
            { originalName: 'mydb', targetName: 'renameddb', selected: true },
        ];

        await runRestorePipeline('exec-pg-mapping', makeInput({ databaseMapping: mapping as any }));

        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        // databaseMapping is passed through to the adapter config.
        expect(restoredConfig.databaseMapping).toEqual(mapping);
        // For non-SQLite, the path should not exist on the config.
        expect(restoredConfig.path).toBeUndefined();
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('does not rewrite path for SQLite when no selected rename entry exists (line 439-448)', async () => {
        const sqliteConfig = {
            ...mockPostgresConfig,
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

        // Mapping entry exists but selected=false, so no rename.
        const mapping = [
            { originalName: 'mydb.sqlite', targetName: 'newdb.sqlite', selected: false },
        ];

        await runRestorePipeline('exec-sqlite-no-rename', makeInput({ databaseMapping: mapping as any }));

        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        // Path must remain unchanged.
        expect(restoredConfig.path).toBe('/data/mydb.sqlite');
    });

    // -------------------------------------------------------------------------
    // Lines 500-514: Success notification and processQueue triggered on success
    // -------------------------------------------------------------------------

    it('fires RESTORE_COMPLETE notification after successful restore (lines 501-514)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-success-notify', makeInput());

        expect(vi.mocked(notifyModule.notify)).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: expect.stringContaining('restore'),
                data: expect.objectContaining({
                    executionId: 'exec-success-notify',
                }),
            }),
        );
    });

    it('calls processQueue after a successful restore (line 560)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-success-queue', makeInput());

        expect(vi.mocked(queueModule.processQueue)).toHaveBeenCalled();
    });

    it('still calls processQueue even when restore fails (finally block, line 560)', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            restore: vi.fn().mockResolvedValue({ success: false, error: 'Restore crashed' }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-fail-queue', makeInput());

        // Execution marked Failed.
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
        // processQueue still called from finally.
        expect(vi.mocked(queueModule.processQueue)).toHaveBeenCalled();
    });

    it('fires RESTORE_COMPLETE notification with correct data fields', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockPostgresConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-notify-fields', makeInput({ file: 'subdir/backup.sql', targetDatabaseName: 'restored_db' }));

        expect(vi.mocked(notifyModule.notify)).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    backupFile: 'backup.sql',
                    targetDatabase: 'restored_db',
                }),
            }),
        );
    });
});
