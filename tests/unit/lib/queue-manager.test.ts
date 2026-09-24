import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
// Import the module under test AFTER mocking dependencies to ensure clean state if needed,
// but top level imports are usually hoisted.
// We will mock runner fully.

// 1. Define Global Mocks
vi.mock('@/lib/prisma', () => ({
    default: {
        systemSetting: {
            findUnique: vi.fn()
        },
        execution: {
            count: vi.fn(),
            findMany: vi.fn()
        }
    }
}));

const mockPerformExecution = vi.fn();

vi.mock('@/lib/runner', () => ({
    performExecution: (...args: any[]) => mockPerformExecution(...args)
}));

const mockIsShutdownRequested = vi.fn().mockReturnValue(false);

vi.mock('@/lib/server/shutdown', () => ({
    isShutdownRequested: () => mockIsShutdownRequested()
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

// 2. Import System Under Test
import { processQueue } from '@/lib/execution/queue-manager';
import { beginDatabaseMaintenance, endDatabaseMaintenance } from '@/lib/server/database-maintenance';

/** The queue as the database holds it: the slots, the jobs of the running runs, the waiting runs. */
function queue({ max, running = [], pending = [] }: { max: number | null; running?: string[]; pending?: { id: string; jobId: string | null }[] }) {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(
        max === null ? null : { key: 'maxConcurrentJobs', value: String(max), description: null, updatedAt: new Date() },
    );
    vi.mocked(prisma.execution.findMany).mockImplementation((async (args: { where: { status: string } }) =>
        args.where.status === 'Running' ? running.map((jobId) => ({ jobId })) : pending) as any);
}

describe('Queue Manager Concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsShutdownRequested.mockReturnValue(false);
    });

    it('should respect maxConcurrentJobs limit under heavy load', async () => {
        queue({ max: 2, running: ['job-a', 'job-b'], pending: [{ id: 'exec-waiting', jobId: 'job-waiting' }] });

        await processQueue();

        expect(mockPerformExecution).not.toHaveBeenCalled();
    });

    it('should start multiple jobs if slots are available', async () => {
        queue({ max: 5, pending: [{ id: 'exec-1', jobId: 'job-1' }, { id: 'exec-2', jobId: 'job-2' }] });

        await processQueue();

        expect(mockPerformExecution.mock.calls).toEqual([['exec-1', 'job-1'], ['exec-2', 'job-2']]);
    }, 15000);

    it('should default to 1 concurrent job if setting missing', async () => {
        queue({ max: null, pending: [{ id: 'exec-1', jobId: 'job-1' }] });

        await processQueue();

        expect(mockPerformExecution).toHaveBeenCalledWith('exec-1', 'job-1');
    });

    it('keeps a second run of a job waiting while the first one runs, and starts the run of another job', async () => {
        queue({ max: 2, running: ['job-1'], pending: [{ id: 'exec-by-hand', jobId: 'job-1' }, { id: 'exec-other', jobId: 'job-2' }] });

        await processQueue();

        expect(mockPerformExecution).toHaveBeenCalledTimes(1);
        expect(mockPerformExecution).toHaveBeenCalledWith('exec-other', 'job-2');
    });

    it('starts only the oldest waiting run of a job, even with slots to spare', async () => {
        queue({ max: 3, pending: [{ id: 'exec-scheduled', jobId: 'job-1' }, { id: 'exec-by-hand', jobId: 'job-1' }] });

        await processQueue();

        expect(mockPerformExecution).toHaveBeenCalledTimes(1);
        expect(mockPerformExecution).toHaveBeenCalledWith('exec-scheduled', 'job-1');
    });

    it('starts nothing while every waiting run belongs to a job that runs', async () => {
        queue({ max: 2, running: ['job-1'], pending: [{ id: 'exec-by-hand', jobId: 'job-1' }] });

        await processQueue();

        expect(mockPerformExecution).not.toHaveBeenCalled();
    });

    it('still starts a waiting run whose job was deleted, which then ends at once', async () => {
        queue({ max: 1, pending: [{ id: 'exec-orphan', jobId: null }] });

        await processQueue();

        expect(mockPerformExecution).toHaveBeenCalledWith('exec-orphan', null);
    });

    it('should skip processing and return early when shutdown is requested', async () => {
        mockIsShutdownRequested.mockReturnValue(true);

        await processQueue();

        // Prisma should never be queried during shutdown
        expect(vi.mocked(prisma.systemSetting.findUnique)).not.toHaveBeenCalled();
        expect(mockPerformExecution).not.toHaveBeenCalled();
    });

    it('should return early when no pending jobs are found', async () => {
        queue({ max: 3 });

        await processQueue();

        expect(mockPerformExecution).not.toHaveBeenCalled();
    });

    it('should return early when running count equals maxJobs (saturation)', async () => {
        // Running runs fill every slot.
        queue({ max: 2, running: ['job-a', 'job-b'], pending: [{ id: 'exec-1', jobId: 'job-1' }] });

        await processQueue();

        expect(mockPerformExecution).not.toHaveBeenCalled();
    });

    it('holds pending jobs back while database maintenance holds the connection', async () => {
        beginDatabaseMaintenance();
        try {
            await processQueue();
        } finally {
            endDatabaseMaintenance();
        }

        expect(vi.mocked(prisma.systemSetting.findUnique)).not.toHaveBeenCalled();
        expect(mockPerformExecution).not.toHaveBeenCalled();
    });
});
