import { describe, it, expect, vi, beforeEach } from 'vitest';
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
