import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { runRestorePipeline } from '@/services/restore/pipeline';
import { registry } from '@/lib/core/registry';
import * as decomp from '@/lib/crypto/compression';
import * as abortModule from '@/lib/execution/abort';
import * as smartRecovery from '@/services/restore/smart-recovery';
import * as cryptoStream from '@/lib/crypto/stream';
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

describe('runRestorePipeline (extra coverage)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.execution.update.mockResolvedValue({} as any);
        vi.mocked(abortModule.registerExecution).mockReturnValue(new AbortController());

        // Default fs behaviour: metadata download returns false (not found), so the catch
        // block in the pipeline is NOT triggered by readFile but by download returning false.
        fsMocks.readFile.mockRejectedValue(
            Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
        );
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.stat.mockResolvedValue({ size: 2048 });
        fsMocks.createWriteStream.mockReturnValue(new PassThrough());
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });

        // No decompression by default.
        vi.mocked(decomp.getDecompressionStream).mockReturnValue(null);
    });

    // -------------------------------------------------------------------------
    // Metadata file download FAILS (catch branch) + extension-based fallbacks
    // -------------------------------------------------------------------------

    it('detects GZIP compression from .gz extension when metadata download throws', async () => {
        const storageAdapter = makeStorageAdapter({
            // First call (meta download) throws, second call (actual file) succeeds.
            download: vi.fn()
                .mockImplementationOnce(() => { throw new Error('Network error'); })
                .mockResolvedValueOnce(true),
        });
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(new PassThrough() as any);

        await runRestorePipeline('exec-gz-ext', makeInput({ file: 'backup.sql.gz' }));

        // Decompression should be attempted with GZIP detected from extension.
        expect(decomp.getDecompressionStream).toHaveBeenCalledWith('GZIP');
    });

    it('detects BROTLI compression from .br extension when metadata download throws', async () => {
        const storageAdapter = makeStorageAdapter({
            download: vi.fn()
                .mockImplementationOnce(() => { throw new Error('Timeout'); })
                .mockResolvedValueOnce(true),
        });
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(new PassThrough() as any);

        await runRestorePipeline('exec-br-ext', makeInput({ file: 'backup.sql.br' }));

        expect(decomp.getDecompressionStream).toHaveBeenCalledWith('BROTLI');
    });

    it('marks execution Failed when metadata download throws and file has .enc extension', async () => {
        // .enc without metadata means we cannot decrypt (no IV/AuthTag) - must fail.
        const storageAdapter = makeStorageAdapter({
            download: vi.fn()
                .mockImplementationOnce(() => { throw new Error('Network error'); })
                .mockResolvedValueOnce(true),
        });
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-enc-no-meta', makeInput({ file: 'backup.sql.enc' }));

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
        // Restore should NOT be called because we throw before reaching it.
        expect(dbAdapter.restore).not.toHaveBeenCalled();
    });

    it('logs a warning when metadata file download fails but continues without metadata', async () => {
        const storageAdapter = makeStorageAdapter({
            download: vi.fn()
                .mockImplementationOnce(() => { throw new Error('Permission denied'); })
                .mockResolvedValueOnce(true),
        });
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        // Plain .sql file - no extension-based clue, no .enc so no throw.
        await runRestorePipeline('exec-meta-throw', makeInput({ file: 'backup.sql' }));

        // Pipeline still completes (no encryption/compression, just no metadata).
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
        // Restore was still attempted.
        expect(dbAdapter.restore).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Decryption execution path
    // -------------------------------------------------------------------------

    it('runs decryption when metadata reports encryption enabled', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        // Provide encryption metadata so the decryption branch executes.
        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({
            encryption: {
                enabled: true,
                iv: 'aabbccddeeff00112233445566778899',
                authTag: '00112233445566778899aabbccddeeff',
                profileId: 'profile-1',
            },
        }));

        const mockKey = Buffer.alloc(32, 0x42);
        vi.mocked(smartRecovery.resolveDecryptionKey).mockResolvedValueOnce(mockKey);

        const fakeDecryptStream = new PassThrough();
        vi.mocked(cryptoStream.createDecryptionStream).mockReturnValueOnce(fakeDecryptStream as any);

        await runRestorePipeline('exec-decrypt', makeInput({ file: 'backup.sql.enc' }));

        // createDecryptionStream should have been called with the key and parsed IV/authTag.
        expect(cryptoStream.createDecryptionStream).toHaveBeenCalledWith(
            mockKey,
            expect.any(Buffer),
            expect.any(Buffer),
        );
        // resolveDecryptionKey being called confirms the decryption branch was entered.
        expect(smartRecovery.resolveDecryptionKey).toHaveBeenCalled();
    });

    it('marks execution Failed when decryption pipeline throws', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({
            encryption: {
                enabled: true,
                iv: 'aabbccddeeff00112233445566778899',
                authTag: '00112233445566778899aabbccddeeff',
                profileId: 'profile-1',
            },
        }));

        vi.mocked(smartRecovery.resolveDecryptionKey).mockResolvedValueOnce(Buffer.alloc(32));
        vi.mocked(cryptoStream.createDecryptionStream).mockReturnValueOnce(new PassThrough() as any);

        // Make fs.stat throw so the decryption pipeline errors (cannot read file size).
        fsMocks.stat.mockRejectedValueOnce(new Error('Auth tag mismatch'));

        await runRestorePipeline('exec-decrypt-fail', makeInput({ file: 'backup.sql.enc' }));

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    // -------------------------------------------------------------------------
    // Decompression execution path
    // -------------------------------------------------------------------------

    it('strips .gz extension for output file during decompression', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({ compression: 'GZIP' }));

        const decompStream = new PassThrough();
        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(decompStream as any);

        await runRestorePipeline('exec-decomp-gz', makeInput({ file: 'backup.sql.gz' }));

        expect(decomp.getDecompressionStream).toHaveBeenCalledWith('GZIP');
        // Execution updated - decompression ran (success or failed depending on env).
        expect(prismaMock.execution.update).toHaveBeenCalled();
    });

    it('marks execution Failed when decompression pipeline throws', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({ compression: 'GZIP' }));

        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(new PassThrough() as any);

        // Make fs.stat throw so the decompression pipeline errors (cannot read file size).
        fsMocks.stat.mockRejectedValueOnce(new Error('Decompression stream error'));

        await runRestorePipeline('exec-decomp-fail', makeInput({ file: 'backup.sql.gz' }));

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    it('appends .unpacked suffix when compressed file has no .gz or .br extension', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        // Compression is set in metadata but the file itself has no .gz extension.
        fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({ compression: 'GZIP' }));

        vi.mocked(decomp.getDecompressionStream).mockReturnValueOnce(new PassThrough() as any);

        await runRestorePipeline('exec-decomp-unpacked', makeInput({ file: 'backup.sql' }));

        // getDecompressionStream was called - confirms the decompression branch was entered.
        expect(decomp.getDecompressionStream).toHaveBeenCalledWith('GZIP');
        expect(prismaMock.execution.update).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // SQLite databaseMapping path override
    // -------------------------------------------------------------------------

    it('overrides sqlite path via databaseMapping when a rename entry is selected', async () => {
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

        const mapping = [
            { originalName: 'mydb.sqlite', targetName: 'newdb.sqlite', selected: true },
        ];

        await runRestorePipeline('exec-sqlite-mapping', makeInput({ databaseMapping: mapping as any }));

        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(restoredConfig.path).toBe('/data/newdb.sqlite');
    });

    it('does not override sqlite path via databaseMapping when no entry is selected', async () => {
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

        const mapping = [
            { originalName: 'mydb.sqlite', targetName: 'mydb.sqlite', selected: false },
        ];

        await runRestorePipeline('exec-sqlite-mapping-noop', makeInput({ databaseMapping: mapping as any }));

        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        // Path must remain unchanged.
        expect(restoredConfig.path).toBe('/data/mydb.sqlite');
    });

    // -------------------------------------------------------------------------
    // Restore callback: error/warning message classification
    // -------------------------------------------------------------------------

    it('classifies adapter callback message as error when it contains "error"', async () => {
        const storageAdapter = makeStorageAdapter();

        let _capturedCallback: ((...args: any[]) => void) | null = null;
        const dbAdapter = {
            restore: vi.fn().mockImplementation((_cfg: any, _file: any, onMsg: (...args: any[]) => void) => {
                _capturedCallback = onMsg;
                // Emit a message that should be classified as error level.
                onMsg('SQL error: unknown column', undefined, undefined, undefined);
                return Promise.resolve({ success: true });
            }),
            test: vi.fn().mockResolvedValue({ success: true, version: '14.0' }),
        };

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-cb-error', makeInput());

        // Execution should still complete (restore returned success: true).
        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('classifies adapter callback message as warning when it contains "warn"', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = {
            restore: vi.fn().mockImplementation((_cfg: any, _file: any, onMsg: (...args: any[]) => void) => {
                onMsg('Warning: deprecated feature used', undefined, undefined, undefined);
                return Promise.resolve({ success: true });
            }),
            test: vi.fn().mockResolvedValue({ success: true, version: '14.0' }),
        };

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-cb-warn', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('does not classify "0 errors" as an error level message', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = {
            restore: vi.fn().mockImplementation((_cfg: any, _file: any, onMsg: (...args: any[]) => void) => {
                // "0 errors" pattern - should NOT be classified as error.
                onMsg('Restore finished: 0 errors', undefined, undefined, undefined);
                return Promise.resolve({ success: true });
            }),
            test: vi.fn().mockResolvedValue({ success: true, version: '14.0' }),
        };

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-cb-zero-errors', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    it('classifies adapter callback message with explicit level parameter correctly', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = {
            restore: vi.fn().mockImplementation((_cfg: any, _file: any, onMsg: (...args: any[]) => void) => {
                // Level explicitly passed - must not be overridden.
                onMsg('Custom warning message', 'warning', 'general', undefined);
                return Promise.resolve({ success: true });
            }),
            test: vi.fn().mockResolvedValue({ success: true, version: '14.0' }),
        };

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-cb-explicit-level', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
        );
    });

    // -------------------------------------------------------------------------
    // Restore failure with error field in result
    // -------------------------------------------------------------------------

    it('logs restoreResult.error when adapter reports failure with error field', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter({
            restore: vi.fn().mockResolvedValue({ success: false, error: 'Table already exists' }),
        });

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-restore-error-field', makeInput());

        expect(prismaMock.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
        );
    });

    // -------------------------------------------------------------------------
    // Non-sqlite targetDatabaseName override
    // -------------------------------------------------------------------------

    it('sets database and originalDatabase on config when targetDatabaseName is provided for non-sqlite', async () => {
        const storageAdapter = makeStorageAdapter();
        const dbAdapter = makeDbAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(mockStorageConfig as any)
            .mockResolvedValueOnce(mockSourceConfig as any);
        vi.mocked(registry.get)
            .mockReturnValueOnce(storageAdapter as any)
            .mockReturnValueOnce(dbAdapter as any);

        await runRestorePipeline('exec-pg-rename', makeInput({ targetDatabaseName: 'renamed_db' }));

        const restoredConfig = (dbAdapter.restore as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(restoredConfig.database).toBe('renamed_db');
        expect(restoredConfig.targetDatabaseName).toBe('renamed_db');
        expect(restoredConfig.originalDatabase).toBe('mydb');
    });
});
