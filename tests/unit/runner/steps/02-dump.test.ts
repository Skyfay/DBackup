import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepExecuteDump } from '@/lib/runner/steps/02-dump';
import { RunnerContext } from '@/lib/runner/types';

// --- Module mocks ---

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

const mockExecuteCombinedDump = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/runner/steps/combined-dump', () => ({
    executeCombinedDump: (...args: unknown[]) => mockExecuteCombinedDump(...args),
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

// Mock fs/promises - used for watcher and rename
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

describe('stepExecuteDump', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes a successful single-DB dump and populates ctx', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);

        await stepExecuteDump(ctx);

        expect(ctx.sourceAdapter!.dump).toHaveBeenCalled();
        expect(ctx.tempFile).toBe('/tmp/Test_Job_2026.sql');
        expect(ctx.dumpSize).toBe(2048);
        expect(ctx.metadata).toBeDefined();
        expect(ctx.metadata.engineVersion).toBe('8.0.32');
        // A database-only backup keeps the accurate "Dumping Databases" stage.
        expect((ctx.setStage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toContain('Dumping Databases');
    });

    it('sets metadata label to "1 DBs" for a single database in array form', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.label).toBe('1 DBs');
        expect(ctx.metadata.count).toBe(1);
        expect(ctx.metadata.names).toEqual(['mydb']);
    });

    it('sets metadata label for multiple databases', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['db1', 'db2', 'db3']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.label).toBe('3 DBs');
        expect(ctx.metadata.count).toBe(3);
    });

    it('auto-discovers databases via getDatabases when job has no selection', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue(['alpha', 'beta', 'gamma']);

        await stepExecuteDump(ctx);

        expect((ctx.sourceAdapter as any).getDatabases).toHaveBeenCalled();
        expect(ctx.metadata.names).toEqual(['alpha', 'beta', 'gamma']);
        expect(ctx.metadata.count).toBe(3);
    });

    it('handles getDatabases failure gracefully (warning logged, dump continues)', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Cannot list DBs'));

        // Should not throw - dump still runs
        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();
        expect(ctx.sourceAdapter!.dump).toHaveBeenCalled();
    });

    it('throws when dump fails', async () => {
        const ctx = makeCtx();
        (ctx.sourceAdapter as any).dump = vi.fn().mockResolvedValue({ success: false, error: 'Connection refused' });

        await expect(stepExecuteDump(ctx)).rejects.toThrow('Dump failed: Connection refused');
    });

    it('uses adapter-returned path when different from original tempFile', async () => {
        const ctx = makeCtx();
        (ctx.sourceAdapter as any).dump = vi.fn().mockResolvedValue({
            success: true,
            path: '/tmp/Test_Job_2026.sql.gz',
            size: 512,
        });

        await stepExecuteDump(ctx);

        expect(ctx.tempFile).toBe('/tmp/Test_Job_2026.sql.gz');
    });

    it('injects pgCompression into sourceConfig when set on job', async () => {
        await import('@/lib/adapters/config-resolver');
        const ctx = makeCtx();
        (ctx.job as any).pgCompression = 'zstd';
        (ctx.job as any).databases = JSON.stringify(['pgdb']);

        await stepExecuteDump(ctx);

        // dump should have been called with a config that includes pgCompression
        const dumpCall = (ctx.sourceAdapter!.dump as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(dumpCall[0].pgCompression).toBe('zstd');
    });

    it('injects adapterId as type into sourceConfig (for dialect selection)', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['db1']);

        await stepExecuteDump(ctx);

        const dumpCall = (ctx.sourceAdapter!.dump as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(dumpCall[0].type).toBe('mysql');
    });

    it('handles comma-separated database string', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: 'db1,db2',
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';

        // resolveAdapterConfig returns a config with a comma-separated database string
        // The step should handle this without throwing
        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();
    });

    it('handles Multi-DB TAR detection and renames file', async () => {
        const tarUtils = await import('@/lib/adapters/database/common/tar-utils');
        (tarUtils.isMultiDbTar as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (tarUtils.readTarManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
            databases: [{ name: 'db1' }, { name: 'db2' }],
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['db1', 'db2']);
        // dump returns a .sql file which should be renamed to .tar
        (ctx.sourceAdapter as any).dump = vi.fn().mockResolvedValue({
            success: true,
            path: '/tmp/Test_Job_2026.sql',
            size: 4096,
        });

        await stepExecuteDump(ctx);

        expect(ctx.metadata?.multiDb).toBeDefined();
        expect(ctx.metadata.multiDb.format).toBe('tar');
        expect(ctx.metadata.multiDb.databases).toEqual(['db1', 'db2']);
    });

    it('skips version detection when adapter has no test() method', async () => {
        const ctx = makeCtx();
        (ctx.sourceAdapter as any).test = undefined;
        (ctx.job as any).databases = JSON.stringify(['db1']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.engineVersion).toBe('unknown');
    });

    it('throws when context is not initialized (no job)', async () => {
        const ctx = makeCtx({ job: undefined });

        await expect(stepExecuteDump(ctx)).rejects.toThrow('Context not initialized');
    });

    it('throws when neither a source adapter nor directory sources are configured', async () => {
        const ctx = makeCtx({ sourceAdapter: undefined, sources: [] });

        await expect(stepExecuteDump(ctx)).rejects.toThrow('Job has no source configured');
    });

    describe('combined dump routing (ctx.sources.length > 0)', () => {
        it('delegates to executeCombinedDump when the job has directory sources', async () => {
            const ctx = makeCtx({ sources: [{ jobSourceId: 'jsrc-1' } as any] });

            await stepExecuteDump(ctx);

            expect(mockExecuteCombinedDump).toHaveBeenCalledWith(ctx);
            expect(ctx.sourceAdapter!.dump).not.toHaveBeenCalled();
        });

        it('delegates to executeCombinedDump for a directory-only job (no sourceAdapter at all)', async () => {
            const ctx = makeCtx({ sourceAdapter: undefined, sources: [{ jobSourceId: 'jsrc-1' } as any] });

            await stepExecuteDump(ctx);

            expect(mockExecuteCombinedDump).toHaveBeenCalledWith(ctx);
        });

        it('does not delegate to executeCombinedDump for a DB-only job (unchanged path)', async () => {
            const ctx = makeCtx({ sources: [] });

            await stepExecuteDump(ctx);

            expect(mockExecuteCombinedDump).not.toHaveBeenCalled();
            expect(ctx.sourceAdapter!.dump).toHaveBeenCalled();
        });
    });

    it('uses All DBs label and fetches DB list when --all-databases option is set', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: '',
            options: '--all-databases',
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue(['sys', 'mysql', 'app']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.label).toBe('3 DBs (fetched)');
        expect(ctx.metadata.names).toEqual(['sys', 'mysql', 'app']);
    });

    it('falls back gracefully when getDatabases fails for --all-databases option', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: '',
            options: '--all-databases',
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockRejectedValue(new Error('Access denied'));

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();
        expect(ctx.metadata.label).toBe('All DBs');
    });

    it('resolves All DBs label when adapter returns empty getDatabases list for string DB config', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: 'myapp',
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        // getDatabases returns nothing - label stays 'All DBs'
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue([]);

        await stepExecuteDump(ctx);

        // database gets overwritten to [] by job config logic, so auto-discover path runs
        expect(ctx.metadata.label).toBe('All DBs');
    });

    it('handles empty string database from adapter config and tries getDatabases', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: '',
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue(['db_a', 'db_b']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.label).toBe('2 DBs (fetched)');
        expect(ctx.metadata.names).toEqual(['db_a', 'db_b']);
    });

    it('handles null/undefined database in adapter config (e.g. MongoDB)', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        (ctx.sourceAdapter as any).getDatabases = vi.fn().mockResolvedValue(['admin', 'app']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.label).toBe('2 DBs (fetched)');
        expect(ctx.metadata.names).toEqual(['admin', 'app']);
    });

    it('captures engine edition when test() returns it', async () => {
        const ctx = makeCtx();
        (ctx.sourceAdapter as any).test = vi.fn().mockResolvedValue({
            success: true,
            version: '16.0',
            edition: 'Express',
        });
        (ctx.job as any).databases = JSON.stringify(['testdb']);

        await stepExecuteDump(ctx);

        expect(ctx.metadata.engineEdition).toBe('Express');
    });

    it('falls back to invalid-JSON databases gracefully', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = '{not valid json}';

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();
        // Empty array fallback means auto-discover path
    });

    it('runs post-dump DB discovery when metadata names are empty after dump', async () => {
        const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
        (resolveAdapterConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
            host: 'localhost',
            database: null,
        });
        const ctx = makeCtx();
        (ctx.job as any).databases = '[]';
        // getDatabases returns empty on metadata calc, then returns data post-dump
        (ctx.sourceAdapter as any).getDatabases = vi.fn()
            .mockResolvedValueOnce([])   // during metadata calc
            .mockResolvedValueOnce(['post_db1', 'post_db2']);  // post-dump

        await stepExecuteDump(ctx);

        expect(ctx.metadata.names).toEqual(['post_db1', 'post_db2']);
        expect(ctx.metadata.label).toBe('2 DBs (auto-discovered)');
    });

    it('skips post-dump discovery when dump result already has DB names', async () => {
        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['mydb']);
        (ctx.sourceAdapter as any).getDatabases = vi.fn();

        await stepExecuteDump(ctx);

        // getDatabases should not be called post-dump since names were already set
        expect((ctx.sourceAdapter as any).getDatabases).not.toHaveBeenCalled();
    });

    it('skips tar rename when file already ends with .tar', async () => {
        const tarUtils = await import('@/lib/adapters/database/common/tar-utils');
        const fsPromises = await import('fs/promises');
        (tarUtils.isMultiDbTar as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (tarUtils.readTarManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
            databases: [{ name: 'db1' }],
        });

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['db1']);
        (ctx.sourceAdapter as any).dump = vi.fn().mockResolvedValue({
            success: true,
            path: '/tmp/Test_Job_2026.tar',
            size: 2048,
        });

        await stepExecuteDump(ctx);

        expect(fsPromises.default.rename).not.toHaveBeenCalled();
        expect(ctx.tempFile).toBe('/tmp/Test_Job_2026.tar');
    });

    it('logs a warning when the multi-DB TAR check itself throws', async () => {
        const tarUtils = await import('@/lib/adapters/database/common/tar-utils');
        (tarUtils.isMultiDbTar as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('TAR error'));

        const ctx = makeCtx();
        (ctx.job as any).databases = JSON.stringify(['db1']);

        await expect(stepExecuteDump(ctx)).resolves.not.toThrow();
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Warning: Could not check for Multi-DB TAR format'),
        );
    });
});
