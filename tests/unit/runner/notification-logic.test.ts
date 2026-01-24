
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepFinalize } from '@/lib/runner/steps/04-completion';
import { registry } from '@/lib/core/registry';
import { decryptConfig } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { RunnerContext } from '@/lib/runner/types';

// Mocks
vi.mock('@/lib/prisma', () => ({
    default: {
        execution: {
            update: vi.fn(),
        }
    }
}));

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
    }
}));

vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((config) => config), // Return config as is
}));

describe('Runner Step: Finalize & Notifications', () => {
    let mockCtx: RunnerContext;
    let mockSend: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSend = vi.fn();

        // Setup registry to return a valid adapter
        // @ts-ignore
        registry.get.mockReturnValue({
            type: 'notification',
            send: mockSend
        });

        // Basic context
        mockCtx = {
            jobId: 'job-1',
            status: 'Success',
            startedAt: new Date(),
            logs: [],
            log: vi.fn(),
            updateProgress: vi.fn(),
            execution: { id: 'exec-1' } as any,
            job: {
                id: 'job-1',
                name: 'Test Job',
                notifications: [],
                notificationEvents: 'ALWAYS',
                source: { name: 'DB' },
            } as any
        };
    });

    it('should update execution status in database', async () => {
        await stepFinalize(mockCtx);
        expect(prisma.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'exec-1' },
            data: expect.objectContaining({ status: 'Success' })
        }));
    });

    it('should send notification when condition is ALWAYS and status is Success', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'ALWAYS';
        mockCtx.status = 'Success';

        await stepFinalize(mockCtx);

        expect(registry.get).toHaveBeenCalledWith('discord');
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should send notification when condition is ALWAYS and status is Failed', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'ALWAYS';
        mockCtx.status = 'Failed';

        await stepFinalize(mockCtx);

        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should NOT send notification when condition is SUCCESS_ONLY and status is Failed', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'SUCCESS_ONLY';
        mockCtx.status = 'Failed';

        await stepFinalize(mockCtx);

        expect(mockSend).not.toHaveBeenCalled();
    });

    it('should send notification when condition is SUCCESS_ONLY and status is Success', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'SUCCESS_ONLY';
        mockCtx.status = 'Success';

        await stepFinalize(mockCtx);

        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should NOT send notification when condition is FAILURE_ONLY and status is Success', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'FAILURE_ONLY';
        mockCtx.status = 'Success';

        await stepFinalize(mockCtx);

        expect(mockSend).not.toHaveBeenCalled();
    });

    it('should send notification when condition is FAILURE_ONLY and status is Failed', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        mockCtx.job!.notificationEvents = 'FAILURE_ONLY';
        mockCtx.status = 'Failed';

        await stepFinalize(mockCtx);

        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple notification channels', async () => {
        mockCtx.job!.notifications = [
            { adapterId: 'discord', config: '{}', name: 'Discord' } as any,
            { adapterId: 'email', config: '{}', name: 'Email' } as any
        ];
        mockCtx.job!.notificationEvents = 'ALWAYS';
        mockCtx.status = 'Success';

        await stepFinalize(mockCtx);

        expect(registry.get).toHaveBeenCalledTimes(2);
        expect(registry.get).toHaveBeenCalledWith('discord');
        expect(registry.get).toHaveBeenCalledWith('email');
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should log error instead of throwing if notification fails', async () => {
        mockCtx.job!.notifications = [{ adapterId: 'discord', config: '{}', name: 'Discord' } as any];
        // @ts-ignore
        mockSend.mockRejectedValueOnce(new Error('Network error'));

        // Should not throw
        await expect(stepFinalize(mockCtx)).resolves.not.toThrow();

        expect(mockCtx.log).toHaveBeenCalledWith(expect.stringContaining('Failed to send notification'));
    });
});
