import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepInitialize } from '@/lib/runner/steps/01-initialize';
import { RunnerContext } from '@/lib/runner/types';

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
    default: {
        job: { findUnique: vi.fn() },
        execution: { create: vi.fn() },
        // Whether the tenant of a destination shares it with customers.
        connectionShare: { count: vi.fn().mockResolvedValue(0) },
    },
}));

// A destination of another tenant counts only while that tenant shares it with the job's tenant.
vi.mock('@/services/sharing/provided', () => ({
    providedConnection: vi.fn().mockResolvedValue(null),
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
        tenantId: 'tenant-1',
        encryptionProfileId: null,
        source: {
            id: 'src-1',
            adapterId: 'mysql',
            config: '{}',
            name: 'My MySQL',
            type: 'database',
            tenantId: 'tenant-1',
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
                    tenantId: 'tenant-1',
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
                    config: { id: 'cfg-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage', tenantId: 'tenant-1' },
                },
                {
                    id: 'dest-2', configId: 'cfg-2', priority: 1, retention: '{}',
                    config: { id: 'cfg-2', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage', tenantId: 'tenant-1' },
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
                    config: { id: 'cfg-1', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage', tenantId: 'tenant-1' },
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
                        excludePatternPresets: [],
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage', tenantId: 'tenant-1' },
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

        it('carries the per-source stop choice through to the runner', async () => {
            // Set on the job source, read much later by whatever prepares the source for
            // reading. Nothing in between looks at it, which is exactly why a break here
            // would go unnoticed until a container was stopped that should not have been.
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                sources: [
                    {
                        id: 'jsrc-1', configId: 'storage-1', priority: 0, path: '/v-live', excludePatterns: '[]',
                        excludePatternPresets: [], stopContainers: false,
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'Docker Host', type: 'storage', tenantId: 'tenant-1' },
                    },
                    {
                        id: 'jsrc-2', configId: 'storage-1', priority: 1, path: '/v-db', excludePatterns: '[]',
                        excludePatternPresets: [], stopContainers: true,
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'Docker Host', type: 'storage', tenantId: 'tenant-1' },
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

            expect(ctx.sources.map((s) => s.stopContainers)).toEqual([false, true]);
        });

        it('warns and skips a directory source whose adapter is missing, keeps the rest', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({
                sources: [
                    {
                        id: 'jsrc-1', configId: 'ghost-1', priority: 0, path: '/data', excludePatterns: '[]',
                        excludePatternPresets: [],
                        config: { id: 'ghost-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage', tenantId: 'tenant-1' },
                    },
                    {
                        id: 'jsrc-2', configId: 'storage-1', priority: 1, path: '/other', excludePatterns: '[]',
                        excludePatternPresets: [],
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage', tenantId: 'tenant-1' },
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
                        excludePatternPresets: [],
                        config: { id: 'ghost-1', adapterId: 'ghost-adapter', config: '{}', name: 'Ghost', type: 'storage', tenantId: 'tenant-1' },
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
                        excludePatternPresets: [],
                        config: { id: 'storage-1', adapterId: 'sftp', config: '{}', name: 'SFTP Server', type: 'storage', tenantId: 'tenant-1' },
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

    describe('destinations another tenant shares', () => {
        const providerDest = {
            id: 'dest-1', configId: 'cfg-msp', priority: 0, retention: '{}',
            config: { id: 'cfg-msp', adapterId: 'local-filesystem', config: '{}', name: 'MSP Storage', type: 'storage', tenantId: 'tenant-msp' },
        };
        const provided = (encryptedOnly: boolean) => ({
            id: 'cfg-msp', name: 'MSP Storage', type: 'storage', adapterId: 'local-filesystem', storageRole: 'destination',
            metadata: null, lastStatus: 'Online', lastHealthCheck: null, createdAt: new Date(), updatedAt: new Date(),
            providerId: 'tenant-msp', providerName: 'MSP', allTenants: false, encryptedOnly, ownRecipients: false,
        });

        async function setup(job: Record<string, unknown>) {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob(job));
            (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
                if (id === 'mysql') return { type: 'database', dump: vi.fn() };
                if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
                return null;
            });
        }

        it('refuses a destination the other tenant no longer shares and never reads its login', async () => {
            const { providedConnection } = await import('@/services/sharing/provided');
            const { resolveAdapterConfig } = await import('@/lib/adapters/config-resolver');
            (providedConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
            await setup({ destinations: [providerDest] });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            expect(ctx.destinations).toHaveLength(1);
            expect(ctx.destinations[0].refusal).toBe('MSP Storage is no longer shared with this tenant');
            expect(ctx.destinations[0].config).toEqual({});
            expect(resolveAdapterConfig).not.toHaveBeenCalledWith(providerDest.config);
        });

        it('refuses a destination that takes only encrypted backups when the job has no key', async () => {
            const { providedConnection } = await import('@/services/sharing/provided');
            (providedConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce(provided(true));
            await setup({ destinations: [providerDest], encryptionProfileId: null });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            expect(ctx.destinations[0].refusal).toContain('takes only encrypted backups');
            expect(ctx.destinations[0].config).toEqual({});
        });

        it('writes an encrypted job into its own folder on a destination that takes only encrypted backups', async () => {
            const { providedConnection } = await import('@/services/sharing/provided');
            (providedConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce(provided(true));
            await setup({ destinations: [providerDest], encryptionProfileId: 'key-1' });

            const ctx = makeCtx({ execution: { id: 'exec-1' } as any });
            await stepInitialize(ctx);

            const dest = ctx.destinations[0];
            expect(dest.refusal).toBeUndefined();
            expect(dest.config).toEqual({ host: 'localhost' });
            await dest.adapter.upload({} as any, '/tmp/local.sql', 'Job/backup.sql');
            const plain = Object.getPrototypeOf(dest.adapter);
            // The view passes the progress, a log it keeps from the customer and the options along.
            expect(plain.upload).toHaveBeenCalledWith({}, '/tmp/local.sql', 'tenants/tenant-1/Job/backup.sql', undefined, undefined, undefined);
            expect(dest.customer).toBe('tenant-1');
        });
    });
});
