/**
 * Tests the RestoreService's background error isolation.
 * Specifically verifies that an unexpected crash in runRestorePipeline
 * is caught and logged without propagating to the caller.
 *
 * Kept in a separate file because vi.mock('@/services/restore/pipeline') would
 * conflict with the end-to-end pipeline mocks in restore-service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { RestoreService } from '@/services/restore/restore-service';

/** A platform admin with a session, who may restore into any target. */
const PLATFORM_ADMIN = { isPlatformAdmin: true, authMethod: "session" } as const;

const { mockLoggerError } = vi.hoisted(() => ({
    mockLoggerError: vi.fn(),
}));

vi.mock('@/services/restore/preflight', () => ({
    preflightRestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/restore/pipeline', () => ({
    runRestorePipeline: vi.fn().mockRejectedValue(new Error('Unexpected pipeline crash')),
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: mockLoggerError,
            debug: vi.fn(),
        }),
    },
}));

describe('RestoreService – background pipeline error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.execution.create.mockResolvedValue({ id: 'exec-bg-err' } as any);
    });

    it('returns success immediately even when the background pipeline rejects', async () => {
        const service = new RestoreService();

        const result = await service.restore({
            storageConfigId: 'st-1',
            file: 'backup.sql',
            targetSourceId: 'src-1',
        }, PLATFORM_ADMIN);

        expect(result.success).toBe(true);
        expect(result.executionId).toBe('exec-bg-err');
    });

    it('logs the background pipeline error without re-throwing', async () => {
        const service = new RestoreService();

        await service.restore({
            storageConfigId: 'st-1',
            file: 'backup.sql',
            targetSourceId: 'src-1',
        }, PLATFORM_ADMIN);

        // Wait for the rejected promise's .catch() to run
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(mockLoggerError).toHaveBeenCalledWith(
            'Background restore failed',
            expect.objectContaining({ executionId: 'exec-bg-err' }),
            expect.anything(),
        );
    });
});
