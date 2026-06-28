import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepInitialize } from '@/lib/runner/steps/01-initialize';
import { RunnerContext } from '@/lib/runner/types';

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
    default: {
        job: { findUnique: vi.fn() },
        execution: { create: vi.fn() },
        retentionPolicy: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        },
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
        execution: { id: 'exec-1' } as any,
        ...overrides,
    } as unknown as RunnerContext;
}

function makeJobWithDest(destOverrides: Record<string, unknown> = {}) {
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
                retentionPolicyId: null,
                config: {
                    id: 'cfg-1',
                    adapterId: 'local-filesystem',
                    config: '{}',
                    name: 'Local',
                    type: 'storage',
                },
                ...destOverrides,
            },
        ],
        notifications: [],
        notificationEvents: 'ALWAYS',
        notificationTemplates: [],
    };
}

function setupRegistryAdapters(registry: { get: ReturnType<typeof vi.fn> }) {
    registry.get.mockImplementation((id: string) => {
        if (id === 'mysql') return { type: 'database', dump: vi.fn() };
        if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
        return null;
    });
}

// --- Tests ---

describe('stepInitialize - retention policy resolution (extra coverage)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Lines 83-87: retentionPolicyId set - fetch RetentionPolicy and use its config
    describe('when dest.retentionPolicyId is set (template source)', () => {
        it('uses the retention policy config from the DB and sets retentionPolicySource to "template"', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            setupRegistryAdapters(registry as any);

            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
                makeJobWithDest({ retentionPolicyId: 'policy-1', retention: '{}' })
            );

            (prisma.retentionPolicy.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'policy-1',
                name: 'Monthly Policy',
                config: JSON.stringify({ mode: 'COUNT', keepLast: 12 }),
            });

            const ctx = makeCtx();
            await stepInitialize(ctx);

            expect(prisma.retentionPolicy.findUnique).toHaveBeenCalledWith({
                where: { id: 'policy-1' },
            });
            expect(ctx.destinations[0].retention).toEqual({ mode: 'COUNT', keepLast: 12 });
            expect(ctx.destinations[0].retentionPolicyName).toBe('Monthly Policy');
            expect(ctx.destinations[0].retentionPolicySource).toBe('template');
        });

        it('falls back to NONE when the retention policy has no config', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            setupRegistryAdapters(registry as any);

            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
                makeJobWithDest({ retentionPolicyId: 'policy-empty', retention: '{}' })
            );

            (prisma.retentionPolicy.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'policy-empty',
                name: 'Empty Policy',
                config: null,
            });

            const ctx = makeCtx();
            await stepInitialize(ctx);

            expect(ctx.destinations[0].retention).toEqual({ mode: 'NONE' });
            expect(ctx.destinations[0].retentionPolicySource).toBe('none');
        });
    });

    // Lines 95-98: no retentionPolicyId, no legacy retention - fall back to default retention policy
    describe('when no retentionPolicyId and no legacy retention (default source)', () => {
        it('fetches the default retention policy and uses its config when available', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            setupRegistryAdapters(registry as any);

            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
                makeJobWithDest({ retentionPolicyId: null, retention: '{}' })
            );

            (prisma.retentionPolicy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'default-policy',
                name: 'Default Retention',
                config: JSON.stringify({ mode: 'COUNT', keepLast: 7 }),
                isDefault: true,
            });

            const ctx = makeCtx();
            await stepInitialize(ctx);

            expect(prisma.retentionPolicy.findFirst).toHaveBeenCalledWith({
                where: { isDefault: true },
            });
            expect(ctx.destinations[0].retention).toEqual({ mode: 'COUNT', keepLast: 7 });
            expect(ctx.destinations[0].retentionPolicyName).toBe('Default Retention');
            expect(ctx.destinations[0].retentionPolicySource).toBe('default');
        });

        it('uses NONE retention when no default policy exists in the DB', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            setupRegistryAdapters(registry as any);

            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
                makeJobWithDest({ retentionPolicyId: null, retention: '{}' })
            );

            (prisma.retentionPolicy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            const ctx = makeCtx();
            await stepInitialize(ctx);

            expect(ctx.destinations[0].retention).toEqual({ mode: 'NONE' });
            expect(ctx.destinations[0].retentionPolicyName).toBeUndefined();
            expect(ctx.destinations[0].retentionPolicySource).toBe('none');
        });

        it('uses NONE retention when default policy has no config', async () => {
            const prisma = (await import('@/lib/prisma')).default;
            const { registry } = await import('@/lib/core/registry');
            setupRegistryAdapters(registry as any);

            (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
                makeJobWithDest({ retentionPolicyId: null, retention: '{}' })
            );

            (prisma.retentionPolicy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'default-policy',
                name: 'Empty Default',
                config: null,
                isDefault: true,
            });

            const ctx = makeCtx();
            await stepInitialize(ctx);

            expect(ctx.destinations[0].retention).toEqual({ mode: 'NONE' });
            expect(ctx.destinations[0].retentionPolicySource).toBe('none');
        });
    });
});
