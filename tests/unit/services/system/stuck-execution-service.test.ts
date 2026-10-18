import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import { abortExecution } from '@/lib/execution/abort';
import { processQueue } from '@/lib/execution/queue-manager';
import {
    sweepStuckExecutions,
    STUCK_TIMEOUT_SETTING,
    DEFAULT_STUCK_TIMEOUT_MINUTES,
} from '@/services/system/stuck-execution-service';
import { HEARTBEAT_KEY } from '@/lib/execution/log-flusher';
import { LogEntry } from '@/lib/core/logs';
import { endFollowers } from '@/lib/execution/follower-runs';

vi.mock('@/lib/prisma', () => ({
    default: {
        systemSetting: { findUnique: vi.fn() },
        execution: { findMany: vi.fn(), updateMany: vi.fn() },
    },
}));

vi.mock('@/lib/execution/abort', () => ({ abortExecution: vi.fn() }));
vi.mock('@/lib/execution/follower-runs', () => ({ LEADING_RUNS: { leading: true }, endFollowers: vi.fn(), endOrphanedFollowers: vi.fn().mockResolvedValue(0) }));
vi.mock('@/lib/execution/queue-manager', () => ({ processQueue: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        }),
    },
}));

const findSetting = prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>;
const findMany = prisma.execution.findMany as ReturnType<typeof vi.fn>;
const updateMany = prisma.execution.updateMany as ReturnType<typeof vi.fn>;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

function execution(overrides: Partial<{ id: string; heartbeatMinutesAgo: number | null; startedMinutesAgo: number }> = {}) {
    const { id = 'exec-1', heartbeatMinutesAgo = 5, startedMinutesAgo = 600 } = overrides;
    return {
        id,
        jobId: 'job-1',
        metadata: heartbeatMinutesAgo === null
            ? null
            : JSON.stringify({ stage: 'Collecting Files', [HEARTBEAT_KEY]: minutesAgo(heartbeatMinutesAgo).toISOString() }),
        logs: JSON.stringify([{ timestamp: new Date().toISOString(), level: 'info', type: 'general', message: 'Job queued' }]),
        startedAt: minutesAgo(startedMinutesAgo),
    };
}

describe('sweepStuckExecutions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findSetting.mockResolvedValue(null);
        updateMany.mockResolvedValue({ count: 1 });
    });

    it('leaves a long run alone as long as it keeps reporting progress', async () => {
        // Ten hours old, well past the threshold, but it reported a minute ago.
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1, startedMinutesAgo: 600 })]);

        const result = await sweepStuckExecutions();

        expect(result).toEqual({ checked: 1, cancelled: 0 });
        expect(updateMany).not.toHaveBeenCalled();
        expect(abortExecution).not.toHaveBeenCalled();
    });

    it('cancels a run that stopped reporting past the threshold', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: DEFAULT_STUCK_TIMEOUT_MINUTES + 30 })]);

        const result = await sweepStuckExecutions();

        expect(result.cancelled).toBe(1);
        expect(abortExecution).toHaveBeenCalledWith('exec-1');
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'exec-1', status: 'Running' },
            data: expect.objectContaining({ status: 'Failed' }),
        }));
    });

    it('watches the runs that work, never one that follows another, and ends the followers of a run it stops', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1000 })]);

        await sweepStuckExecutions();

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'Running', AND: [{ leading: true }] } }));
        expect(endFollowers).toHaveBeenCalledWith('exec-1', 'Failed');
    });

    it('signals the run before writing it off, so it can unwind on its own', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1000 })]);

        const order: string[] = [];
        (abortExecution as ReturnType<typeof vi.fn>).mockImplementation(() => { order.push('abort'); return true; });
        updateMany.mockImplementation(async () => { order.push('update'); return { count: 1 }; });

        await sweepStuckExecutions();

        expect(order).toEqual(['abort', 'update']);
    });

    it('leaves a reason in the execution log', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1000 })]);

        await sweepStuckExecutions();

        const written = JSON.parse(updateMany.mock.calls[0][0].data.logs) as LogEntry[];
        expect(written).toHaveLength(2);
        expect(written[1].level).toBe('error');
        expect(written[1].message).toContain('watchdog');
    });

    it('releases the queue once something was cancelled', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1000 })]);

        await sweepStuckExecutions();

        // The whole point: the slot a stuck run occupied blocks every job queued behind it.
        expect(processQueue).toHaveBeenCalled();
    });

    it('does not touch the queue when nothing was cancelled', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1 })]);

        await sweepStuckExecutions();

        expect(processQueue).not.toHaveBeenCalled();
    });

    it('falls back to the start time when no heartbeat was ever written', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: null, startedMinutesAgo: 1000 })]);

        const result = await sweepStuckExecutions();

        expect(result.cancelled).toBe(1);
    });

    it('does nothing at all when the watchdog is switched off', async () => {
        findSetting.mockResolvedValue({ key: STUCK_TIMEOUT_SETTING, value: '0' });

        const result = await sweepStuckExecutions();

        expect(result).toEqual({ checked: 0, cancelled: 0 });
        expect(findMany).not.toHaveBeenCalled();
    });

    it('honours a configured threshold shorter than the default', async () => {
        findSetting.mockResolvedValue({ key: STUCK_TIMEOUT_SETTING, value: '30' });
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 45 })]);

        const result = await sweepStuckExecutions();

        expect(result.cancelled).toBe(1);
    });

    it('falls back to the default rather than disabling itself on a malformed setting', async () => {
        findSetting.mockResolvedValue({ key: STUCK_TIMEOUT_SETTING, value: 'not-a-number' });
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: DEFAULT_STUCK_TIMEOUT_MINUTES + 1 })]);

        const result = await sweepStuckExecutions();

        expect(result.cancelled).toBe(1);
    });

    it('does not count a run that finished between the read and the write', async () => {
        findMany.mockResolvedValue([execution({ heartbeatMinutesAgo: 1000 })]);
        updateMany.mockResolvedValue({ count: 0 });

        const result = await sweepStuckExecutions();

        expect(result.cancelled).toBe(0);
        expect(processQueue).not.toHaveBeenCalled();
    });
});
