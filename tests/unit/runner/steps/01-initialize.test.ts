import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepInitialize } from '@/lib/runner/steps/01-initialize';
import { RunnerContext } from '@/lib/runner/types';

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
    default: {
        job: { findUnique: vi.fn() },
        execution: { create: vi.fn() },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn(), register: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ host: 'localhost' }),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

// --- Helpers ---

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

function makeJob(overrides: Record<string, unknown> = {}) {
    return {
        id: 'job-1',
        name: 'Test Job',
        source: {
            id: 'src-1',
            adapterId: 'mysql',
            config: '{}',
            name: 'My MySQL',
            type: 'database',
            primaryCredentialId: null,
            sshCredentialId: null,
        },
        destinations: [
            {
                id: 'dest-1',
                configId: 'cfg-1',
                priority: 0,
                retention: '{}',
                config: {
                    id: 'cfg-1',
                    adapterId: 'local-filesystem',
                    config: '{}',
                    name: 'Local',
                    type: 'storage',
                },
            },
        ],
        sources: [],
        notifications: [],
        notificationEvents: 'ALWAYS',
        ...overrides,
    };
}

// --- Tests ---

describe('stepInitialize', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when job is not found', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await expect(stepInitialize(makeCtx())).rejects.toThrow('Job job-1 not found');
    });

    it('throws when job has no source', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({ source: null }));

        await expect(stepInitialize(makeCtx())).rejects.toThrow('has no source configured');
    });

    it('throws when job has no destinations', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({ destinations: [] }));

        await expect(stepInitialize(makeCtx())).rejects.toThrow('no destinations configured');
    });

    it('creates execution record when ctx.execution is not set', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob());
        (prisma.execution.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exec-new' });
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: undefined });
        await stepInitialize(ctx);

        expect(prisma.execution.create).toHaveBeenCalled();
        expect(ctx.execution).toEqual({ id: 'exec-new' });
    });

    it('skips execution creation when ctx.execution is already set', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob());
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: { id: 'existing-exec' } as any });
        await stepInitialize(ctx);

        expect(prisma.execution.create).not.toHaveBeenCalled();
        expect(ctx.execution!.id).toBe('existing-exec');
    });

    it('throws when source adapter is not in the registry', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

        const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
        await expect(stepInitialize(ctx)).rejects.toThrow("Source adapter 'mysql' not found");
    });

    it('warns and skips a destination whose adapter is missing, keeps the rest', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
            destinations: [
                {
                    id: 'dest-1', configId: 'cfg-1', priority: 0, retention: '{}',
                    config: { id: 'cfg-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage' },
                },
                {
                    id: 'dest-2', configId: 'cfg-2', priority: 1, retention: '{}',
                    config: { id: 'cfg-2', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage' },
                },
            ],
        }));
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
        await stepInitialize(ctx);

        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Warning'), 'warning');
        expect(ctx.destinations).toHaveLength(1);
        expect(ctx.destinations[0].adapterId).toBe('local-filesystem');
    });

    it('throws when all destination adapters are missing', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob());
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
        await expect(stepInitialize(ctx)).rejects.toThrow('No valid destination adapters could be resolved');
    });

    it('falls back to NONE retention policy when retention JSON is invalid', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
            destinations: [
                {
                    id: 'dest-1', configId: 'cfg-1', priority: 0,
                    retention: 'NOT_VALID_JSON',
                    config: { id: 'cfg-1', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage' },
                },
            ],
        }));
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
        await stepInitialize(ctx);

        expect(ctx.destinations[0].retention).toEqual({ mode: 'NONE' });
        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Failed to parse retention'),
            'warning',
        );
    });

    it('populates ctx.job, ctx.sourceAdapter and ctx.destinations on success', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');
        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob());
        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
        await stepInitialize(ctx);

        expect(ctx.job).toBeDefined();
        expect(ctx.sourceAdapter).toBeDefined();
        expect(ctx.destinations).toHaveLength(1);
        expect(ctx.destinations[0].configName).toBe('Local');
        expect(ctx.destinations[0].priority).toBe(0);
    });

    describe('directory sources (JobSource)', () => {
        it('resolves job.sources into ctx.sources', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                sources: [
                    {
                        id: 'jsrc-1', configId: 'storage-1', priority: 0, path: '/data', excludePatterns: '["*.tmp"]',
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage' },
                    },
                ],
            }));
            (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
                if (id === 'mysql') return { type: 'database', dump: vi.fn() };
                if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
                if (id === 'sftp') return { type: 'storage', upload: vi.fn(), download: vi.fn() };
                return null;
            });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            expect(ctx.sources).toHaveLength(1);
            expect(ctx.sources[0]).toMatchObject({
                jobSourceId: 'jsrc-1',
                configId: 'storage-1',
                configName: 'SFTP Server',
                remotePath: '/data',
                excludePatterns: ['*.tmp'],
                priority: 0,
            });
        });

        it('warns and skips a directory source whose adapter is missing, keeps the rest', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                sources: [
                    {
                        id: 'jsrc-1', configId: 'ghost-1', priority: 0, path: '/data', excludePatterns: '[]',
                        config: { id: 'ghost-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage' },
                    },
                    {
                        id: 'jsrc-2', configId: 'storage-1', priority: 1, path: '/other', excludePatterns: '[]',
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage' },
                    },
                ],
            }));
            (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
                if (id === 'mysql') return { type: 'database', dump: vi.fn() };
                if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
                if (id === 'sftp') return { type: 'storage', upload: vi.fn(), download: vi.fn() };
                return null;
            });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Warning'), 'warning');
            expect(ctx.sources).toHaveLength(1);
            expect(ctx.sources[0].configId).toBe('storage-1');
        });

        it('throws when every directory source adapter is missing', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                sources: [
                    {
                        id: 'jsrc-1', configId: 'ghost-1', priority: 0, path: '/data', excludePatterns: '[]',
                        config: { id: 'ghost-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage' },
                    },
                ],
            }));
            (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
                if (id === 'mysql') return { type: 'database', dump: vi.fn() };
                if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
                return null;
            });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await expect(stepInitialize(ctx)).rejects.toThrow('No valid directory source adapters could be resolved');
        });

        it('does not require a database source when the job has directory sources (directory-only job)', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                source: null,
                sources: [
                    {
                        id: 'jsrc-1', configId: 'storage-1', priority: 0, path: '/data', excludePatterns: '[]',
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage' },
                    },
                ],
            }));
            (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
                if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
                if (id === 'sftp') return { type: 'storage', upload: vi.fn(), download: vi.fn() };
                return null;
            });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            expect(ctx.sourceAdapter).toBeUndefined();
            expect(ctx.sources).toHaveLength(1);
        });
    });
});
