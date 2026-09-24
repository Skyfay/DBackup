import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepCleanup, stepFinalize } from '@/lib/runner/steps/04-completion';
import { RunnerContext } from '@/lib/runner/types';

// --- Module mocks ---

vi.mock('fs/promises', () => ({
    default: {
        access: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockResolvedValue(undefined),
    },
    access: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma', () => ({
    default: {
        execution: { update: vi.fn().mockResolvedValue({}) },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e) => e),
    getErrorMessage: vi.fn((e) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('@/lib/notifications', () => ({
    renderTemplate: vi.fn().mockReturnValue({
        title: 'Backup Complete',
        message: 'Job finished',
        fields: [],
        color: '#00ff00',
        success: true,
        badge: 'Success',
    }),
    NOTIFICATION_EVENTS: {
        BACKUP_SUCCESS: 'backup.success',
        BACKUP_FAILURE: 'backup.failure',
    },
}));

vi.mock('@/services/notifications/notification-log-service', () => ({
    recordNotificationLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/core/logs', () => ({
    PIPELINE_STAGES: {
        NOTIFICATIONS: 'Sending Notifications',
    },
}));

// Mock dynamic imports used inside stepFinalize
vi.mock('@/services/dashboard-service', () => ({
    refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined),
}));

// --- Helpers ---

function makeDestination(overrides = {}) {
    return {
        configId: 'cfg-1',
        configName: 'Local',
        adapterId: 'local-filesystem',
        config: {},
        retention: { mode: 'NONE' },
        priority: 0,
        adapter: {} as any,
        uploadResult: { success: true, path: 'Test Job/backup.sql' },
        ...overrides,
    };
}

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        job: {
            id: 'job-1',
            name: 'Test Job',
            notificationEvents: 'ALWAYS',
            source: { id: 'src-1', adapterId: 'mysql', name: 'My MySQL', type: 'database' },
            destinations: [],
            notifications: [],
        } as any,
        execution: { id: 'exec-1' } as any,
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [makeDestination() as any],
        tempFile: '/tmp/backup.sql',
        dumpSize: 1024,
        finalRemotePath: 'Test Job/backup.sql',
        metadata: { count: 1, names: ['mydb'] },
        status: 'Success',
        startedAt: new Date(Date.now() - 5000),
        ...overrides,
    } as unknown as RunnerContext;
}

// --- stepCleanup tests ---

describe('stepCleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deletes the temp file when it exists', async () => {
        const fsPromises = await import('fs/promises');
        const ctx = makeCtx();

        await stepCleanup(ctx);

        expect(fsPromises.default.unlink).toHaveBeenCalledWith('/tmp/backup.sql');
        expect(ctx.log).toHaveBeenCalledWith('Temporary file cleaned up');
    });

    it('does nothing silently when fs.access throws (file not found)', async () => {
        const fsPromises = await import('fs/promises');
        (fsPromises.default.access as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('ENOENT'),
        );

        const ctx = makeCtx();
        await expect(stepCleanup(ctx)).resolves.not.toThrow();
        expect(fsPromises.default.unlink).not.toHaveBeenCalled();
    });

    it("removes the run's own directory with whatever a step left in it", async () => {
        const fsPromises = await import('fs/promises');
        const ctx = makeCtx({ runDir: '/tmp/dbackup-run-1', tempFile: '/tmp/dbackup-run-1/backup.tar' });

        await stepCleanup(ctx);

        expect(fsPromises.default.rm).toHaveBeenCalledWith('/tmp/dbackup-run-1', { recursive: true, force: true });
    });

    it('does nothing when ctx.tempFile is not set', async () => {
        const fsPromises = await import('fs/promises');
        const ctx = makeCtx({ tempFile: undefined });

        await stepCleanup(ctx);

        expect(fsPromises.default.access).not.toHaveBeenCalled();
        expect(fsPromises.default.unlink).not.toHaveBeenCalled();
    });
});

// --- stepFinalize tests ---

describe('stepFinalize', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when execution is not set', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const ctx = makeCtx({ execution: undefined });

        await stepFinalize(ctx);

        expect(prisma.execution.update).not.toHaveBeenCalled();
    });

    it('updates the execution record with final status and metadata', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const ctx = makeCtx();

        await stepFinalize(ctx);

        expect(prisma.execution.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'exec-1' },
                data: expect.objectContaining({ status: 'Success' }),
            }),
        );
    });

    it('skips notifications when shouldNotify is false (FAILURE_ONLY on Success)', async () => {
        const { renderTemplate } = await import('@/lib/notifications');
        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'FAILURE_ONLY';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'discord', name: 'Discord', config: '{}' },
        ];

        await stepFinalize(ctx);

        expect(renderTemplate).not.toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Skipping notifications'));
    });

    it('sends notification when condition is ALWAYS', async () => {
        const { registry } = await import('@/lib/core/registry');
        const { recordNotificationLog } = await import('@/services/notifications/notification-log-service');
        const mockNotifyAdapter = { send: vi.fn().mockResolvedValue(undefined) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);

        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'ALWAYS';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'slack', name: 'Slack', config: '{}' },
        ];

        await stepFinalize(ctx);

        expect(mockNotifyAdapter.send).toHaveBeenCalled();
        expect(recordNotificationLog).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'Success' }),
        );
    });

    it('records a failed notification log when adapter.send throws', async () => {
        const { registry } = await import('@/lib/core/registry');
        const { recordNotificationLog } = await import('@/services/notifications/notification-log-service');
        const mockNotifyAdapter = { send: vi.fn().mockRejectedValue(new Error('Webhook failed')) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);

        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'ALWAYS';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'discord', name: 'Discord', config: '{}' },
        ];

        await stepFinalize(ctx);

        expect(ctx.log).toHaveBeenCalledWith(
            expect.stringContaining('Failed to send notification to channel Discord'),
        );
        expect(recordNotificationLog).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'Failed' }),
        );
    });

    it('sends notification on Partial status with FAILURE_ONLY condition', async () => {
        const { registry } = await import('@/lib/core/registry');
        const mockNotifyAdapter = { send: vi.fn().mockResolvedValue(undefined) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);

        const ctx = makeCtx({ status: 'Partial' });
        (ctx.job as any).notificationEvents = 'FAILURE_ONLY';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'discord', name: 'Discord', config: '{}' },
        ];

        await stepFinalize(ctx);

        expect(mockNotifyAdapter.send).toHaveBeenCalled();
    });

    it('sends notification on SUCCESS_ONLY when status is Success', async () => {
        const { registry } = await import('@/lib/core/registry');
        const mockNotifyAdapter = { send: vi.fn().mockResolvedValue(undefined) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);

        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'SUCCESS_ONLY';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'discord', name: 'Discord', config: '{}' },
        ];

        await stepFinalize(ctx);

        expect(mockNotifyAdapter.send).toHaveBeenCalled();
    });

    it('handles storage stats cache failure silently after a successful backup', async () => {
        const { refreshStorageStatsCache } = await import('@/services/dashboard-service');
        (refreshStorageStatsCache as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('Cache unavailable'),
        );

        const ctx = makeCtx({ status: 'Success' });

        await stepFinalize(ctx);

        // Allow non-blocking microtasks to settle
        await new Promise((r) => setTimeout(r, 20));
        // Should not throw - cache refresh failure is handled silently
    });

    it('skips adapter.send when registry returns no adapter for channel', async () => {
        const { registry } = await import('@/lib/core/registry');
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'ALWAYS';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'unknown-channel', name: 'Unknown', config: '{}' },
        ];

        await expect(stepFinalize(ctx)).resolves.not.toThrow();
    });

    it('includes error log message in notification payload when status is Failed', async () => {
        const { registry } = await import('@/lib/core/registry');
        const { renderTemplate } = await import('@/lib/notifications');
        const mockNotifyAdapter = { send: vi.fn().mockResolvedValue(undefined) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);

        const ctx = makeCtx({ status: 'Failed' });
        ctx.logs = [{ timestamp: new Date().toISOString(), level: 'error', type: 'general', message: 'Connection timeout' }];
        (ctx.job as any).notificationEvents = 'ALWAYS';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'discord', name: 'Discord', config: '{}' },
        ];

        await stepFinalize(ctx);

        const renderCall = (renderTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(renderCall.data.error).toBe('Connection timeout');
    });

    it('renders Slack-specific payload with fields when channel is slack', async () => {
        const { registry } = await import('@/lib/core/registry');
        const { renderTemplate } = await import('@/lib/notifications');
        const mockNotifyAdapter = { send: vi.fn().mockResolvedValue(undefined) };
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(mockNotifyAdapter);
        (renderTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
            title: 'Backup Complete',
            message: 'Success',
            fields: [{ name: 'Duration', value: '5s' }, { name: 'Size', value: '2 MB' }],
            color: '#00ff00',
            success: true,
            badge: 'OK',
        });

        const ctx = makeCtx({ status: 'Success' });
        (ctx.job as any).notificationEvents = 'ALWAYS';
        (ctx.job as any).notifications = [
            { id: 'n1', adapterId: 'slack', name: 'Slack', config: '{}' },
        ];

        await stepFinalize(ctx);

        const sendCall = mockNotifyAdapter.send.mock.calls[0];
        expect(sendCall).toBeDefined();
    });
});
