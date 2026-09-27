import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogFlusher, HEARTBEAT_KEY } from '@/lib/execution/log-flusher';
import prisma from '@/lib/prisma';
import { LogEntry } from '@/lib/core/logs';

vi.mock('@/lib/prisma', () => ({
    default: {
        execution: {
            update: vi.fn(),
        },
    },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

const update = prisma.execution.update as ReturnType<typeof vi.fn>;

const entry = (message: string): LogEntry => ({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'general',
    message,
});

/** The metadata JSON of the nth write, parsed. */
function writtenMetadata(call: number): Record<string, unknown> {
    return JSON.parse(update.mock.calls[call][0].data.metadata);
}

/** The log messages of the nth write. */
function writtenMessages(call: number): string[] {
    return (JSON.parse(update.mock.calls[call][0].data.logs) as LogEntry[]).map((l) => l.message);
}

describe('createLogFlusher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        update.mockResolvedValue({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes the first request immediately', async () => {
        const logs: LogEntry[] = [entry('started')];
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => logs,
            getMetadata: () => ({ stage: 'Initializing' }),
        });

        flusher.schedule();
        await vi.runOnlyPendingTimersAsync();

        expect(update).toHaveBeenCalledTimes(1);
        expect(writtenMessages(0)).toEqual(['started']);
    });

    it('still persists a throttled request instead of dropping it', async () => {
        // The bug this exists to prevent: a run records something inside the throttle window
        // and then blocks for hours, leaving the database showing the state from before.
        const logs: LogEntry[] = [entry('started')];
        let stage = 'Initializing';
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => logs,
            getMetadata: () => ({ stage }),
            intervalMs: 1000,
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);
        expect(update).toHaveBeenCalledTimes(1);

        // Everything below happens well inside the window and would previously be lost.
        stage = 'Collecting Files';
        logs.push(entry('scanning'));
        flusher.schedule();
        expect(update).toHaveBeenCalledTimes(1);

        // No further calls of any kind - the pipeline is now blocked.
        await vi.advanceTimersByTimeAsync(1000);

        expect(update).toHaveBeenCalledTimes(2);
        expect(writtenMetadata(1).stage).toBe('Collecting Files');
        expect(writtenMessages(1)).toEqual(['started', 'scanning']);
    });

    it('coalesces a burst inside the window into one deferred write', async () => {
        const logs: LogEntry[] = [];
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => logs,
            getMetadata: () => ({ files: logs.length }),
            intervalMs: 1000,
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);

        for (let i = 0; i < 50; i++) {
            logs.push(entry(`file ${i}`));
            flusher.schedule();
        }
        await vi.advanceTimersByTimeAsync(1000);

        // One catch-up write, carrying the newest state rather than fifty of them.
        expect(update).toHaveBeenCalledTimes(2);
        expect(writtenMetadata(1).files).toBe(50);
    });

    it('records a heartbeat on every write', async () => {
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => [],
            getMetadata: () => ({ stage: 'Uploading' }),
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);

        const metadata = writtenMetadata(0);
        expect(metadata.stage).toBe('Uploading');
        expect(typeof metadata[HEARTBEAT_KEY]).toBe('string');
        expect(Number.isNaN(new Date(metadata[HEARTBEAT_KEY] as string).getTime())).toBe(false);
    });

    it('flush() writes at once regardless of the window', async () => {
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => [],
            getMetadata: () => ({ stage: 'Completed' }),
            intervalMs: 60_000,
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);
        await flusher.flush();

        expect(update).toHaveBeenCalledTimes(2);
        expect(writtenMetadata(1).stage).toBe('Completed');
    });

    it('dispose() cancels a deferred write so it cannot land after the final status', async () => {
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => [],
            getMetadata: () => ({ stage: 'Uploading' }),
            intervalMs: 1000,
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);
        flusher.schedule();
        flusher.dispose();

        await vi.advanceTimersByTimeAsync(5000);

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('writes the lines that come after dispose() without the metadata the run ended with', async () => {
        const logs: LogEntry[] = [entry('Upload complete')];
        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => logs,
            getMetadata: () => ({ stage: 'Completed' }),
            intervalMs: 1000,
        });

        flusher.dispose();
        // The finalize step has written the final metadata by now, the notifications log on after it.
        logs.push(entry('Sending notifications...'));
        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0].data.metadata).toBeUndefined();
        expect(writtenMessages(0)).toEqual(['Upload complete', 'Sending notifications...']);
    });

    it('keeps going when a write fails', async () => {
        update.mockRejectedValueOnce(new Error('database is locked'));

        const flusher = createLogFlusher({
            executionId: 'exec-1',
            getLogs: () => [],
            getMetadata: () => ({ stage: 'Uploading' }),
            intervalMs: 1000,
        });

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(0);

        flusher.schedule();
        await vi.advanceTimersByTimeAsync(1000);

        // A lost progress write must not take the backup down with it.
        expect(update).toHaveBeenCalledTimes(2);
    });
});
