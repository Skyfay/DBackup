import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stepRetention } from '@/lib/runner/steps/05-retention';
import { RunnerContext, DestinationContext } from '@/lib/runner/types';

// --- Module mocks ---

vi.mock('@/services/backup/retention-service', () => ({
    RetentionService: {
        calculateRetention: vi.fn().mockReturnValue({ keep: [], delete: [], keptForChain: [] }),
    },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

vi.mock('@/services/dashboard-service', () => ({
    refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/storage/storage-service', () => ({
    storageService: {
        appendStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
        updateStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
        removeStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
        readCachedListing: vi.fn().mockResolvedValue(null),
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
        configName: 'Local',
        adapterId: 'local-filesystem',
        config: {},
        retention: { mode: 'KEEP_LAST', keepLast: 3 } as any,
        priority: 0,
        adapter: {
            upload: vi.fn(),
            list: vi.fn().mockResolvedValue([
                { name: 'backup1.sql', path: '/backups/backup1.sql', size: 1024, lastModified: new Date('2025-01-01') },
                { name: 'backup2.sql', path: '/backups/backup2.sql', size: 1024, lastModified: new Date('2025-01-02') },
            ]),
            delete: vi.fn().mockResolvedValue(undefined),
        } as any,
        uploadResult: { success: true, path: '/backups/backup2.sql' },
        ...overrides,
    };
}

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        job: {
            id: 'job-1',
            name: 'Test Job',
            source: { id: 'src-1', adapterId: 'mysql', name: 'MySQL', type: 'database' },
        } as any,
        execution: { id: 'exec-1' } as any,
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [makeDestination()],
        status: 'Success',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

// --- Tests ---

describe('stepRetention', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when context is not ready (no job)', async () => {
        const ctx = makeCtx({ job: undefined });
        await expect(stepRetention(ctx)).rejects.toThrow('Context not ready for retention');
    });

    it('throws when context is not ready (no destinations)', async () => {
        const ctx = makeCtx({ destinations: [] });
        await expect(stepRetention(ctx)).rejects.toThrow('Context not ready for retention');
    });

    it('skips retention for destinations where upload was not successful', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const dest = makeDestination({
            uploadResult: { success: false, error: 'Upload failed' },
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        expect(RetentionService.calculateRetention).not.toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Retention: Skipped (upload was not successful)'),
        );
    });

    it('skips retention when destination has no policy (mode NONE)', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const dest = makeDestination({ retention: { mode: 'NONE' } });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        expect(RetentionService.calculateRetention).not.toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('No policy configured'));
    });

    it('skips retention when storage adapter does not support list()', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                // no list method
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        expect(RetentionService.calculateRetention).not.toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('does not support listing files'));
    });

    it('calls calculateRetention with listed files and deletes old backups', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const fileToDelete = {
            name: 'old_backup.sql',
            path: '/backups/old_backup.sql',
            size: 1024,
            lastModified: new Date('2024-12-01'),
        };
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({
            keep: [{ name: 'backup2.sql', path: '/backups/backup2.sql' }],
            delete: [fileToDelete],
            keptForChain: [],
        });

        const dest = makeDestination();
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        expect(RetentionService.calculateRetention).toHaveBeenCalled();
        expect(dest.adapter.delete).toHaveBeenCalledWith(dest.config, '/backups/old_backup.sql');
        // Also deletes .meta.json sidecar
        expect(dest.adapter.delete).toHaveBeenCalledWith(dest.config, '/backups/old_backup.sql.meta.json');
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Keeping 1, Deleting 1'));
    });

    it('logs the selected retention template name when applying policy', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [], delete: [], keptForChain: [] });

        const dest = makeDestination({
            retention: { mode: 'SMART', smart: { daily: 1, weekly: 1, monthly: 1, yearly: 0 } } as any,
            retentionPolicyName: 'Default GFS',
            retentionPolicySource: 'template',
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Retention: Applying policy SMART (template: Default GFS)...')
        );
    });

    it('logs an error but does not throw when a delete fails', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({
            keep: [],
            delete: [{ name: 'old.sql', path: '/backups/old.sql', size: 100, lastModified: new Date() }],
            keptForChain: [],
        });

        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([
                    { name: 'old.sql', path: '/backups/old.sql', size: 100, lastModified: new Date() },
                ]),
                delete: vi.fn().mockRejectedValue(new Error('Permission denied')),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await expect(stepRetention(ctx)).resolves.not.toThrow();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Retention Error deleting old.sql'));
    });

    it('logs a process error but does not throw when applyRetentionForDestination throws', async () => {
        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockRejectedValue(new Error('List failed')),
                delete: vi.fn(),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await expect(stepRetention(ctx)).resolves.not.toThrow();
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Retention Process Error: List failed'),
            'error',
        );
    });

    it('reads .meta.json to detect locked files and skips them', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const file = {
            name: 'locked.sql',
            path: '/backups/locked.sql',
            size: 1024,
            lastModified: new Date(),
        };
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [file], delete: [], keptForChain: [] });

        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([file]),
                delete: vi.fn(),
                read: vi.fn().mockResolvedValue(JSON.stringify({ locked: true })),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        // The locked flag should be set on the file before calculateRetention is called
        const retentionCall = (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(retentionCall[0][0].locked).toBe(true);
    });

    it('ignores read errors when checking locked status', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [], delete: [], keptForChain: [] });

        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([
                    { name: 'backup.sql', path: '/backups/backup.sql', size: 512, lastModified: new Date() },
                ]),
                delete: vi.fn(),
                read: vi.fn().mockRejectedValue(new Error('Not found')),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await expect(stepRetention(ctx)).resolves.not.toThrow();
    });

    it('leaves the backups of another job in the folder out of the policy', async () => {
        // A job named like a deleted one writes into the same folder. What the deleted job left
        // there is not this job's to delete, and must not take up the places of its policy.
        const { RetentionService } = await import('@/services/backup/retention-service');
        const at = (name: string, day: string) => ({ name, path: `/Test Job/${name}`, size: 1024, lastModified: new Date(day) });
        const own = at('own.sql', '2026-06-08');
        const unknown = at('before-sidecars.sql', '2026-05-01');
        const left = at('left-by-deleted-job.sql', '2026-04-01');
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [own], delete: [], keptForChain: [] });

        const jobs: Record<string, string | undefined> = { 'own.sql': 'job-1', 'left-by-deleted-job.sql': 'job-deleted' };
        const dest = makeDestination({
            uploadResult: { success: true, path: '/Test Job/own.sql' },
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([
                    own, unknown, left,
                    { name: 'own.sql.meta.json', path: '/Test Job/own.sql.meta.json', size: 200, lastModified: new Date() },
                    { name: 'left-by-deleted-job.sql.meta.json', path: '/Test Job/left-by-deleted-job.sql.meta.json', size: 200, lastModified: new Date() },
                ]),
                delete: vi.fn(),
                read: vi.fn(async (_config: unknown, remotePath: string) => {
                    const name = remotePath.split('/').pop()!.replace('.meta.json', '');
                    return JSON.stringify({ jobId: jobs[name] });
                }),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        const judged = (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mock.calls[0][0] as { name: string }[];
        // A backup without a sidecar still counts as the job's own, like before.
        expect(judged.map((f) => f.name).sort()).toEqual(['before-sidecars.sql', 'own.sql']);
        expect(dest.adapter.delete).not.toHaveBeenCalledWith(dest.config, left.path);
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('1 backup(s) in this folder belong to another job and are left alone: left-by-deleted-job.sql'), 'info');
    });

    describe('a renamed job', () => {
        const at = (path: string, day = '2026-06-01') => ({ name: path.split('/').pop()!, path, size: 1024, lastModified: new Date(day) });
        const sidecarOf = (file: { path: string }) => ({ name: `${file.path.split('/').pop()}.meta.json`, path: `${file.path}.meta.json`, size: 200, lastModified: new Date() });

        /** The current folder "Test Job" and the folder "Old Name" the job wrote into before its rename. */
        function renamedJob(jobs: Record<string, string>) {
            const current = at('Test Job/new.sql', '2026-06-08');
            const old = at('Old Name/old.sql');
            const other = at('Old Name/other.sql');
            const folders: Record<string, ReturnType<typeof at>[]> = { 'Test Job': [current], 'Old Name': [old, other] };
            const dest = makeDestination({
                uploadResult: { success: true, path: 'Test Job/new.sql' },
                adapter: {
                    upload: vi.fn(),
                    list: vi.fn(async (_config: unknown, dir: string) => (folders[dir] ?? []).flatMap((file) => [file, sidecarOf(file)])),
                    delete: vi.fn().mockResolvedValue(undefined),
                    read: vi.fn(async (_config: unknown, remotePath: string) => JSON.stringify({ jobId: jobs[remotePath.replace('.meta.json', '')] })),
                } as any,
            });
            return { dest, current, old, other };
        }

        // Back to the defaults of the module mocks, so no later test runs on what these set.
        afterEach(async () => {
            const { RetentionService } = await import('@/services/backup/retention-service');
            const { storageService } = await import('@/services/storage/storage-service');
            (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [], delete: [], keptForChain: [] });
            (storageService.readCachedListing as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        });

        it('judges the backups it left in the folder of its old name with its policy', async () => {
            const { RetentionService } = await import('@/services/backup/retention-service');
            const { storageService } = await import('@/services/storage/storage-service');
            const { dest, current, old } = renamedJob({ 'Test Job/new.sql': 'job-1', 'Old Name/old.sql': 'job-1', 'Old Name/other.sql': 'job-2' });
            (storageService.readCachedListing as ReturnType<typeof vi.fn>).mockResolvedValue({
                files: [{ ...current, jobId: 'job-1' }, { ...old, jobId: 'job-1' }],
                listedAt: new Date(),
                current: true,
            });
            (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockImplementation((files: { name: string }[]) => ({
                keep: files.filter((f) => f.name === 'new.sql'),
                delete: files.filter((f) => f.name === 'old.sql'),
                keptForChain: [],
            }));
            const ctx = makeCtx({ destinations: [dest] });

            await stepRetention(ctx);

            const judged = (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mock.calls[0][0] as { path: string }[];
            // The backup of another job in that folder is not this job's to judge.
            expect(judged.map((f) => f.path).sort()).toEqual(['Old Name/old.sql', 'Test Job/new.sql']);
            expect(dest.adapter.delete).toHaveBeenCalledWith(dest.config, 'Old Name/old.sql');
            expect(dest.adapter.delete).toHaveBeenCalledWith(dest.config, 'Old Name/old.sql.meta.json');
            expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Also judging 1 backup(s) this job left in Old Name/ before it was renamed.'));
        });

        it('never lists the root of the destination or its current folder a second time', async () => {
            const { storageService } = await import('@/services/storage/storage-service');
            const { dest, current } = renamedJob({ 'Test Job/new.sql': 'job-1' });
            (storageService.readCachedListing as ReturnType<typeof vi.fn>).mockResolvedValue({
                files: [{ ...current, jobId: 'job-1' }, { ...at('stray.sql'), jobId: 'job-1' }],
                listedAt: new Date(),
                current: true,
            });

            await stepRetention(makeCtx({ destinations: [dest] }));

            expect(dest.adapter.list).toHaveBeenCalledTimes(1);
            expect(dest.adapter.list).toHaveBeenCalledWith(dest.config, 'Test Job');
        });

        it('keeps to its current folder when the cached listing cannot be read', async () => {
            const { RetentionService } = await import('@/services/backup/retention-service');
            const { storageService } = await import('@/services/storage/storage-service');
            const { dest } = renamedJob({ 'Test Job/new.sql': 'job-1', 'Old Name/old.sql': 'job-1' });
            (storageService.readCachedListing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('database is locked'));
            (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [], delete: [], keptForChain: [] });

            await stepRetention(makeCtx({ destinations: [dest] }));

            const judged = (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mock.calls[0][0] as { path: string }[];
            expect(judged.map((f) => f.path)).toEqual(['Test Job/new.sql']);
        });
    });

    it('warns by name when a file mtime disagrees with its recorded creation time', async () => {
        // A destination whose modification times were reset has to be visible in the run
        // log, otherwise the only symptom is backups quietly disappearing.
        const { RetentionService } = await import('@/services/backup/retention-service');
        const file = {
            name: 'moved.sql',
            path: '/backups/moved.sql',
            size: 1024,
            lastModified: new Date('2026-06-08T12:00:00Z'),
        };
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [file], delete: [], keptForChain: [] });

        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([
                    file,
                    { name: 'moved.sql.meta.json', path: '/backups/moved.sql.meta.json', size: 200, lastModified: new Date() },
                ]),
                delete: vi.fn(),
                read: vi.fn().mockResolvedValue(JSON.stringify({ timestamp: '2026-06-01T12:00:00Z' })),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        const warnings = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[1] === 'warning');
        expect(warnings.some(c => String(c[0]).includes('moved.sql'))).toBe(true);
        expect(warnings.some(c => String(c[0]).includes('2026-06-01T12:00:00.000Z'))).toBe(true);
    });

    it('stays quiet when the recorded time and the mtime agree', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const file = {
            name: 'normal.sql',
            path: '/backups/normal.sql',
            size: 1024,
            lastModified: new Date('2026-06-08T12:00:30Z'),
        };
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({ keep: [file], delete: [], keptForChain: [] });

        const dest = makeDestination({
            adapter: {
                upload: vi.fn(),
                list: vi.fn().mockResolvedValue([
                    file,
                    { name: 'normal.sql.meta.json', path: '/backups/normal.sql.meta.json', size: 200, lastModified: new Date() },
                ]),
                delete: vi.fn(),
                read: vi.fn().mockResolvedValue(JSON.stringify({ timestamp: '2026-06-08T12:00:00Z' })),
            } as any,
        });
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        const warnings = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[1] === 'warning');
        expect(warnings).toHaveLength(0);
    });

    it('triggers storage stats cache refresh when at least one file was deleted', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const { refreshStorageStatsCache } = await import('@/services/dashboard-service');
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({
            keep: [],
            delete: [{ name: 'old.sql', path: '/backups/old.sql', size: 100, lastModified: new Date() }],
            keptForChain: [],
        });

        const dest = makeDestination();
        const ctx = makeCtx({ destinations: [dest] });

        await stepRetention(ctx);

        // Allow the non-blocking dynamic import to complete
        await new Promise((r) => setTimeout(r, 10));
        expect(refreshStorageStatsCache).toHaveBeenCalled();
    });

    it('handles cache refresh failure silently after deletion', async () => {
        const { RetentionService } = await import('@/services/backup/retention-service');
        const { refreshStorageStatsCache } = await import('@/services/dashboard-service');
        (refreshStorageStatsCache as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('Cache error'),
        );
        (RetentionService.calculateRetention as ReturnType<typeof vi.fn>).mockReturnValue({
            keep: [],
            delete: [{ name: 'old.sql', path: '/backups/old.sql', size: 100, lastModified: new Date() }],
            keptForChain: [],
        });

        const dest = makeDestination();
        const ctx = makeCtx({ destinations: [dest] });

        await expect(stepRetention(ctx)).resolves.not.toThrow();
    });
});
