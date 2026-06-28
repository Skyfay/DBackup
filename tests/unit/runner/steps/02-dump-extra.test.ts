import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepExecuteDump } from '@/lib/runner/steps/02-dump';
import { RunnerContext } from '@/lib/runner/types';

// --- Module mocks (mirrors 02-dump.test.ts) ---

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ host: 'localhost', database: 'testdb' }),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('@/lib/backup-extensions', () => ({
    getBackupFileExtension: vi.fn().mockReturnValue('sql'),
}));

vi.mock('@/lib/utils', () => ({
    formatBytes: vi.fn().mockReturnValue('100 B/s'),
}));

vi.mock('@/lib/adapters/database/common/tar-utils', () => ({
    isMultiDbTar: vi.fn().mockResolvedValue(false),
    readTarManifest: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e) => e),
}));

vi.mock('@/lib/prisma', () => ({
    default: {
        systemSetting: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        namingTemplate: {
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
        },
    },
}));

// Mock fs/promises - used for watcher stat and rename.
vi.mock('fs/promises', () => ({
    default: {
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
        rename: vi.fn().mockResolvedValue(undefined),
    },
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    rename: vi.fn().mockResolvedValue(undefined),
}));

// --- Helpers ---

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    const logs: string[] = [];
    return {
        jobId: 'job-1',
        job: {
            id: 'job-1',
            name: 'Test Job',
            databases: '[]',
            pgCompression: undefined,
            source: {
                id: 'src-1',
                adapterId: 'mysql',
                config: '{}',
                name: 'My MySQL',
                type: 'database',
                primaryCredentialId: null,
                sshCredentialId: null,
            },
            destinations: [],
            notifications: [],
            notificationEvents: 'ALWAYS',
        } as any,
        execution: { id: 'exec-1' } as any,
        logs: [],
        log: vi.fn((msg: string) => logs.push(msg)),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        sourceAdapter: {
            type: 'database',
            dump: vi.fn().mockResolvedValue({ success: true, path: '/tmp/Test_Job_2026.sql', size: 2048 }),
            test: vi.fn().mockResolvedValue({ success: true, version: '8.0.32' }),
        } as any,
        destinations: [],
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as RunnerContext;
}

// --- Tests ---

describe('stepExecuteDump (extra coverage)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // getDatabases() throws during pre-dump metadata collection
    // -------------------------------------------------------------------------

    it('logs a warning but does not crash when getDatabases throws during --all-databases metadata collection', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: '',
            options: '--all-databases',
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Permission denied to list DBs'));

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();

        // Label stays at 'All DBs' because fetch failed.
        expect(ctx.metadata.label).toBe('All DBs');
        // A warning was logged.
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Warning: Could not fetch DB list for metadata'),
        );
        // Dump still ran.
        expect(ctx.sourceAdapter!.dump).toHaveBeenCalled();
    });

    it('logs a warning but does not crash when getDatabases throws for null database config', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Socket timeout'));

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();

        expect(ctx.metadata.label).toBe('All DBs');
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Warning: Could not fetch DB list for metadata'),
        );
    });

    it('logs a warning but does not crash when getDatabases throws for empty array database config', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Auth failed'));

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();

        expect(ctx.metadata.label).toBe('All DBs');
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Warning: Could not fetch DB list for metadata'),
        );
    });

    it('logs a warning but does not crash when getDatabases throws for empty string database config', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: '',
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Connection refused'));

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();

        expect(ctx.metadata.label).toBe('All DBs');
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Warning: Could not fetch DB list for metadata'),
        );
    });

    // -------------------------------------------------------------------------
    // File size watcher - clearInterval is called when dump completes
    // -------------------------------------------------------------------------

    it('clears the file-size watcher interval after a successful dump', async () => {
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);

        await stepExecuteDump(ctx);

        // clearInterval must be called at least once (from the finally block in the dump step).
        expect(clearIntervalSpy).toHaveBeenCalled();

        clearIntervalSpy.mockRestore();
    });

    it('clears the file-size watcher interval even when dump throws', async () => {
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);
        (ctx.sourceAdapter as any).dump = vi.fn().mockRejectedValue(new Error('Unexpected crash'));

        await expect(stepExecuteDump(ctx)).rejects.toThrow();

        // clearInterval must still be called (finally block).
        expect(clearIntervalSpy).toHaveBeenCalled();

        clearIntervalSpy.mockRestore();
    });

    it('clears the file-size watcher interval when dump returns failure', async () => {
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);
        (ctx.sourceAdapter as any).dump = vi.fn().mockResolvedValue({ success: false, error: 'OOM' });

        await expect(stepExecuteDump(ctx)).rejects.toThrow('Dump failed: OOM');

        expect(clearIntervalSpy).toHaveBeenCalled();

        clearIntervalSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // Post-dump getDatabases() call
    // -------------------------------------------------------------------------

    it('calls getDatabases after dump when metadata names are empty (null db config)', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';

        // Pre-dump call returns empty - forces post-dump discovery.
        // Post-dump call returns real list.
        (ctx.sourceAdapter as any).getDatabases = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(['db_one', 'db_two', 'db_three']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.names).toEqual(['db_one', 'db_two', 'db_three']);
        expect(ctx.metadata.count).toBe(3);
        expect(ctx.metadata.label).toBe('3 DBs (auto-discovered)');
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('auto-discovered'),
        );
    });

    it('logs a warning when post-dump getDatabases throws', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';

        // Pre-dump: empty list (names will be []), triggers post-dump path.
        // Post-dump: throws.
        (ctx.sourceAdapter as any).getDatabases = vi.fn()
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('Post-dump list failed'));

        // Should not throw - warning is logged.
        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();

        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Post-dump DB discovery failed'),
            'warning',
        );
    });

    it('logs that adapter does not support getDatabases in post-dump path', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';

        // No getDatabases method on adapter - names stay empty, post-dump branch hits
        // the "Adapter does not support getDatabases" log path.
        delete (ctx.sourceAdapter as any).getDatabases;

        await stepExecuteDump(ctx);

        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Adapter does not support getDatabases'),
        );
    });

    it('logs that post-dump discovery returned no databases when getDatabases returns empty', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';

        // Both calls return empty.
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue([]);

        await stepExecuteDump(ctx);

        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Post-dump DB discovery returned no databases'),
        );
    });

    // -------------------------------------------------------------------------
    // Watcher actually updates detail via updateDetail
    // -------------------------------------------------------------------------

    it('invokes updateDetail with size info when watcher fires and file exists', async () => {
        vi.useFakeTimers();

        const fsPromises = await import('fs/promises');
        (fsPromises.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 512 * 1024 });

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);

        // Make dump hang until we manually advance timers.
        let resolveDump!: (v: any) => void;
        (ctx.sourceAdapter as any).dump = vi.fn().mockReturnValue(
            new Promise((resolve) => { resolveDump = resolve; }),
        );

        const dumpPromise = stepExecuteDump(ctx);

        // Advance timers so the watcher callback fires.
        await vi.advanceTimersByTimeAsync(800);

        // Resolve the dump.
        resolveDump({ success: true, path: '/tmp/Test_Job_2026.sql', size: 512 * 1024 });

        await dumpPromise;

        expect(ctx.updateDetail).toHaveBeenCalled();
        const call = (ctx.updateDetail as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(call).toContain('MB dumped');

        vi.useRealTimers();
    });
});
