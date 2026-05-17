import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepUpload } from '@/lib/runner/steps/03-upload';
import { RunnerContext, DestinationContext } from '@/lib/runner/types';

// --- Module mocks ---

// Use vi.hoisted so the same vi.fn() reference is available to both the factory
// and the test bodies (required for named built-in module exports).
const { mockPipeline } = vi.hoisted(() => ({
    mockPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => ({
    default: {
        stat: vi.fn().mockResolvedValue({ size: 2048 }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
    },
    stat: vi.fn().mockResolvedValue({ size: 2048 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
    default: {
        createReadStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
        createWriteStream: vi.fn().mockReturnValue({ on: vi.fn() }),
    },
    createReadStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
    createWriteStream: vi.fn().mockReturnValue({ on: vi.fn() }),
}));

// Provide a single mockPipeline reference for both default and named export so
// both the source file and test bodies operate on the same vi.fn() instance.
vi.mock('stream/promises', () => ({
    pipeline: mockPipeline,
    default: { pipeline: mockPipeline },
}));

vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
}));

vi.mock('@/lib/crypto/stream', () => ({
    createEncryptionStream: vi.fn().mockReturnValue({
        stream: { pipe: vi.fn() },
        getAuthTag: vi.fn().mockReturnValue(Buffer.from('aabbcc', 'hex')),
        iv: Buffer.from('aabbccdd', 'hex'),
    }),
}));

vi.mock('@/lib/crypto/compression', () => ({
    getCompressionStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
    getCompressionExtension: vi.fn().mockReturnValue('.gz'),
    CompressionType: {},
}));

vi.mock('@/lib/streams/progress-monitor', () => ({
    // Invoke the callback immediately so the arrow function body is covered.
    ProgressMonitorStream: class MockProgressMonitorStream {
        constructor(_size: number, cb: (processed: number, total: number, percent: number, speed: number) => void) {
            cb(512, 1024, 50, 256);
        }
    },
}));

vi.mock('@/lib/utils', () => ({
    formatBytes: vi.fn().mockReturnValue('2 KB'),
}));

vi.mock('@/lib/crypto/checksum', () => ({
    calculateFileChecksum: vi.fn().mockResolvedValue('abc123checksum'),
    verifyFileChecksum: vi.fn().mockResolvedValue({ valid: true, expected: 'abc123', actual: 'abc123' }),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('@/lib/core/logs', () => ({
    PIPELINE_STAGES: {
        PROCESSING: 'Processing',
        UPLOADING: 'Uploading',
        VERIFYING: 'Verifying',
    },
}));

vi.mock('@/lib/prisma', () => ({
    default: {
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    },
}));

// --- Helpers ---

function makeDestination(overrides: Partial<DestinationContext> = {}): DestinationContext {
    return {
        configId: 'cfg-1',
        configName: 'Local Storage',
        adapterId: 'local-filesystem',
        config: {},
        retention: { mode: 'NONE' },
        priority: 0,
        adapter: {
            upload: vi.fn().mockResolvedValue(true),
            download: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            delete: vi.fn().mockResolvedValue(undefined),
        } as any,
        ...overrides,
    };
}

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        job: {
            id: 'job-1',
            name: 'Test Job',
            compression: 'NONE',
            encryptionProfileId: null,
            pgCompression: undefined,
            source: { id: 'src-1', adapterId: 'mysql', name: 'My MySQL', type: 'database' },
            destinations: [],
            notifications: [],
            notificationEvents: 'ALWAYS',
        } as any,
        execution: { id: 'exec-1' } as any,
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        sourceAdapter: undefined,
        destinations: [makeDestination()],
        tempFile: '/tmp/test_backup.sql',
        dumpSize: 2048,
        metadata: { count: 1, names: ['mydb'], label: 'Single DB', engineVersion: '8.0' },
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

// --- Tests ---

describe('stepUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when context is not ready (no job)', async () => {
        const ctx = makeCtx({ job: undefined });
        await expect(stepUpload(ctx)).rejects.toThrow('Context not ready for upload');
    });

    it('throws when context is not ready (no destinations)', async () => {
        const ctx = makeCtx({ destinations: [] });
        await expect(stepUpload(ctx)).rejects.toThrow('Context not ready for upload');
    });

    it('throws when context is not ready (no tempFile)', async () => {
        const ctx = makeCtx({ tempFile: undefined });
        await expect(stepUpload(ctx)).rejects.toThrow('Context not ready for upload');
    });

    it('sets stage to UPLOADING when no compression or encryption is configured', async () => {
        const ctx = makeCtx();
        (ctx.job as any).compression = 'NONE';
        (ctx.job as any).encryptionProfileId = null;

        await stepUpload(ctx);

        expect(ctx.setStage).toHaveBeenCalledWith('Uploading');
        expect(ctx.setStage).not.toHaveBeenCalledWith('Processing');
    });

    it('sets stage to PROCESSING when compression is enabled', async () => {
        const ctx = makeCtx();
        (ctx.job as any).compression = 'GZIP';
        (ctx.job as any).encryptionProfileId = null;

        await stepUpload(ctx);

        expect(ctx.setStage).toHaveBeenCalledWith('Processing');
    });

    it('sets stage to PROCESSING when encryption is enabled', async () => {
        const ctx = makeCtx();
        (ctx.job as any).compression = 'NONE';
        (ctx.job as any).encryptionProfileId = 'profile-1';

        await stepUpload(ctx);

        expect(ctx.setStage).toHaveBeenCalledWith('Processing');
    });

    it('extends tempFile with .gz when compression runs the pipeline', async () => {
        const ctx = makeCtx();
        (ctx.job as any).compression = 'GZIP';
        (ctx.job as any).encryptionProfileId = null;

        await stepUpload(ctx);

        expect(ctx.tempFile).toContain('.gz');
    });

    it('extends tempFile with .enc when encryption runs the pipeline', async () => {
        const ctx = makeCtx();
        (ctx.job as any).compression = 'NONE';
        (ctx.job as any).encryptionProfileId = 'profile-1';

        await stepUpload(ctx);

        expect(ctx.tempFile).toContain('.enc');
    });

    it('throws when the processing pipeline fails', async () => {
        mockPipeline.mockRejectedValueOnce(new Error('Disk full'));

        const ctx = makeCtx();
        (ctx.job as any).compression = 'GZIP';

        await expect(stepUpload(ctx)).rejects.toThrow('Pipeline processing failed: Disk full');
    });

    it('throws when encryption key retrieval fails', async () => {
        const { getProfileMasterKey } = await import('@/services/backup/encryption-service');
        (getProfileMasterKey as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('Key not found'),
        );

        const ctx = makeCtx();
        (ctx.job as any).compression = 'NONE';
        (ctx.job as any).encryptionProfileId = 'bad-profile';

        await expect(stepUpload(ctx)).rejects.toThrow('Encryption setup failed: Key not found');
    });

    it('calculates checksum and writes metadata sidecar', async () => {
        const { calculateFileChecksum } = await import('@/lib/crypto/checksum');
        const fsPromises = await import('fs/promises');

        const ctx = makeCtx();
        await stepUpload(ctx);

        expect(calculateFileChecksum).toHaveBeenCalledWith('/tmp/test_backup.sql');
        expect(fsPromises.default.writeFile).toHaveBeenCalledWith(
            '/tmp/test_backup.sql.meta.json',
            expect.stringContaining('abc123checksum'),
        );
    });

    it('calls upload for metadata sidecar and main file on each destination', async () => {
        const dest = makeDestination({ adapterId: 's3' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(dest.adapter.upload).toHaveBeenCalledTimes(2);
        // First call = metadata sidecar
        expect((dest.adapter.upload as ReturnType<typeof vi.fn>).mock.calls[0][2]).toContain('.meta.json');
        // Second call = main file
        expect((dest.adapter.upload as ReturnType<typeof vi.fn>).mock.calls[1][2]).not.toContain('.meta.json');
    });

    it('marks destination upload result as success when adapter returns true', async () => {
        const dest = makeDestination({ adapterId: 's3' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(dest.uploadResult?.success).toBe(true);
        expect(dest.uploadResult?.path).toBe('Test Job/test_backup.sql');
    });

    it('marks destination upload result as failed when adapter throws', async () => {
        const dest = makeDestination({
            adapterId: 's3',
            adapter: {
                upload: vi.fn()
                    .mockResolvedValueOnce(true)  // metadata sidecar succeeds
                    .mockRejectedValueOnce(new Error('S3 timeout')),  // main file fails
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        // Single failing destination means all uploads failed -> throws
        await expect(stepUpload(ctx)).rejects.toThrow('All 1 destination upload(s) failed');
        expect(dest.uploadResult?.success).toBe(false);
        expect(dest.uploadResult?.error).toContain('S3 timeout');
    });

    it('throws when adapter upload returns false instead of throwing', async () => {
        const dest = makeDestination({
            adapterId: 's3',
            adapter: {
                upload: vi.fn()
                    .mockResolvedValueOnce(true)   // metadata sidecar ok
                    .mockResolvedValueOnce(false),  // main file returns false
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await expect(stepUpload(ctx)).rejects.toThrow('All 1 destination upload(s) failed');
        expect(dest.uploadResult?.error).toContain('Adapter returned false');
    });

    it('invokes progress and log callbacks passed to the adapter', async () => {
        // Make the upload mock invoke the destProgress callback and the log callback
        const dest = makeDestination({
            adapterId: 's3',
            adapter: {
                upload: vi.fn().mockImplementation(
                    async (_config: unknown, _src: unknown, _remote: unknown, onProgress?: (pct: number) => void, onLog?: (...args: unknown[]) => void) => {
                        if (onProgress) onProgress(50);
                        if (onLog) onLog('Uploading chunk...', 'info', undefined, undefined);
                        return true;
                    },
                ),
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest], dumpSize: 2048 });

        await stepUpload(ctx);

        expect(ctx.updateStageProgress).toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Uploading chunk...'),
            'info',
            undefined,
            undefined,
        );
    });

    it('sets status to Partial when some destinations succeed and others fail', async () => {
        const successDest = makeDestination({ configId: 'cfg-1', configName: 'S3', adapterId: 's3' });
        const failDest = makeDestination({
            configId: 'cfg-2',
            configName: 'Broken',
            adapterId: 's3',
            adapter: {
                upload: vi.fn()
                    .mockResolvedValueOnce(true)
                    .mockRejectedValueOnce(new Error('Broken')),
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });

        const ctx = makeCtx({ destinations: [successDest, failDest] });
        await stepUpload(ctx);

        expect(ctx.status).toBe('Partial');
    });

    it('throws when all destination uploads fail', async () => {
        const failDest = makeDestination({
            adapterId: 's3',
            adapter: {
                upload: vi.fn()
                    .mockResolvedValueOnce(true)  // metadata sidecar
                    .mockRejectedValueOnce(new Error('Network error')),  // main file
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });

        const ctx = makeCtx({ destinations: [failDest] });
        await expect(stepUpload(ctx)).rejects.toThrow('All 1 destination upload(s) failed');
    });

    it('performs post-upload integrity verification for local-filesystem destinations', async () => {
        const { verifyFileChecksum } = await import('@/lib/crypto/checksum');
        const dest = makeDestination({ adapterId: 'local-filesystem' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(dest.adapter.download).toHaveBeenCalled();
        expect(verifyFileChecksum).toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Integrity check passed'), 'success');
    });

    it('logs a warning when post-upload integrity check fails', async () => {
        const { verifyFileChecksum } = await import('@/lib/crypto/checksum');
        (verifyFileChecksum as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            valid: false,
            expected: 'abc123',
            actual: 'badchecksum',
        });

        const dest = makeDestination({ adapterId: 'local-filesystem' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Integrity check FAILED'), 'warning');
    });

    it('skips integrity verification for non-local-filesystem destinations', async () => {
        const { verifyFileChecksum } = await import('@/lib/crypto/checksum');
        const dest = makeDestination({ adapterId: 's3' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(verifyFileChecksum).not.toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('No local destinations'));
    });

    it('uses percentage-based detail string when dumpSize is zero', async () => {
        const dest = makeDestination({
            adapterId: 's3',
            adapter: {
                upload: vi.fn().mockImplementation(
                    async (_c: unknown, _s: unknown, _r: unknown, onProgress?: (pct: number) => void) => {
                        if (onProgress) onProgress(75);
                        return true;
                    },
                ),
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
        });
        // dumpSize = 0 triggers the else branch in destProgress
        const ctx = makeCtx({ destinations: [dest], dumpSize: 0 });

        await stepUpload(ctx);

        expect(ctx.updateDetail).toHaveBeenCalledWith(expect.stringContaining('75%'));
    });

    it('sets finalRemotePath to the first successful upload path', async () => {
        const dest = makeDestination({ adapterId: 's3' });
        const ctx = makeCtx({ destinations: [dest] });

        await stepUpload(ctx);

        expect(ctx.finalRemotePath).toBe('Test Job/test_backup.sql');
    });

    it('includes multiDb metadata in the written sidecar', async () => {
        const fsPromises = await import('fs/promises');
        const ctx = makeCtx();
        ctx.metadata = {
            ...ctx.metadata,
            multiDb: { format: 'tar', databases: ['db1', 'db2'] },
        };

        await stepUpload(ctx);

        const written = (fsPromises.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
        const parsed = JSON.parse(written);
        expect(parsed.multiDb).toEqual({ format: 'tar', databases: ['db1', 'db2'] });
    });
});
