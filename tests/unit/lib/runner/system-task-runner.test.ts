import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { SystemTaskRunner } from '@/lib/runner/system-task-runner';

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

vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e) => e),
}));

const STAGE_MAP: Record<string, [number, number]> = {
    Initializing: [0, 10],
    Running: [10, 90],
    Completed: [90, 100],
};

async function makeRunner(): Promise<SystemTaskRunner> {
    prismaMock.execution.create.mockResolvedValue({ id: 'exec-1' } as any);
    return SystemTaskRunner.create('IntegrityCheck', 'Manual', 'Test trigger', STAGE_MAP);
}

describe('SystemTaskRunner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.execution.update.mockResolvedValue({} as any);
        prismaMock.execution.updateMany.mockResolvedValue({ count: 1 });
    });

    describe('create()', () => {
        it('creates an execution record with status Pending', async () => {
            prismaMock.execution.create.mockResolvedValue({ id: 'exec-1' } as any);

            await SystemTaskRunner.create('IntegrityCheck');

            expect(prismaMock.execution.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'Pending',
                        type: 'IntegrityCheck',
                    }),
                })
            );
        });

        it('stores the initial log entry in the execution record', async () => {
            prismaMock.execution.create.mockResolvedValue({ id: 'exec-1' } as any);

            await SystemTaskRunner.create('IntegrityCheck');

            const call = prismaMock.execution.create.mock.calls[0][0];
            const logs = JSON.parse(call.data.logs);
            expect(logs).toHaveLength(1);
            expect(logs[0].message).toBe('Task queued');
        });

        it('passes triggerType and triggerLabel when provided', async () => {
            prismaMock.execution.create.mockResolvedValue({ id: 'exec-1' } as any);

            await SystemTaskRunner.create('IntegrityCheck', 'Scheduler', 'daily-job');

            expect(prismaMock.execution.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        triggerType: 'Scheduler',
                        triggerLabel: 'daily-job',
                    }),
                })
            );
        });

        it('exposes the execution id via the id getter', async () => {
            prismaMock.execution.create.mockResolvedValue({ id: 'exec-abc' } as any);
            const runner = await SystemTaskRunner.create('IntegrityCheck');
            expect(runner.id).toBe('exec-abc');
        });
    });

    describe('start()', () => {
        it('transitions execution status to Running', async () => {
            const runner = await makeRunner();
            prismaMock.execution.updateMany.mockResolvedValue({ count: 1 });

            await runner.start();

            expect(prismaMock.execution.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'exec-1', status: 'Pending' },
                    data: expect.objectContaining({ status: 'Running' }),
                })
            );
        });

        it('throws when execution has already been claimed (concurrent call)', async () => {
            const runner = await makeRunner();
            prismaMock.execution.updateMany.mockResolvedValue({ count: 0 });

            await expect(runner.start()).rejects.toThrow('Execution already claimed by a concurrent call');
        });
    });

    describe('finish()', () => {
        it('updates execution status to Success', async () => {
            const runner = await makeRunner();

            await runner.finish('Success');

            expect(prismaMock.execution.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'exec-1' },
                    data: expect.objectContaining({ status: 'Success' }),
                })
            );
        });

        it('updates execution status to Failed', async () => {
            const runner = await makeRunner();

            await runner.finish('Failed');

            expect(prismaMock.execution.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'Failed' }),
                })
            );
        });

        it('sets endedAt on finish', async () => {
            const runner = await makeRunner();

            await runner.finish('Success');

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            expect(call.data.endedAt).toBeDefined();
        });
    });

    describe('setStage()', () => {
        it('updates currentStage and sets progress to the stage range minimum', async () => {
            const runner = await makeRunner();

            runner.setStage('Running');

            // Force flush to check the update
            await runner.flushLogs(true);

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const meta = JSON.parse(call.data.metadata);
            expect(meta.stage).toBe('Running');
            expect(meta.progress).toBe(10);
        });

        it('emits a completion log for the previous stage when switching stages', async () => {
            const runner = await makeRunner();
            runner.setStage('Running'); // start Running
            runner.setStage('Completed'); // switch away from Running - adds completion log

            await runner.finish('Success');

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const logs = JSON.parse(call.data.logs);
            const completionEntry = logs.find(
                (l: { message: string }) => l.message.includes('Running completed')
            );
            expect(completionEntry).toBeDefined();
        });

        it('does not emit completion log when stage stays the same', async () => {
            const runner = await makeRunner();
            runner.setStage('Running');
            runner.setStage('Running'); // no change

            await runner.flushLogs(true);

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const logs = JSON.parse(call.data.logs);
            const completionEntries = logs.filter(
                (l: { message: string }) => l.message.includes('Running completed')
            );
            expect(completionEntries).toHaveLength(0);
        });
    });

    describe('updateStageProgress()', () => {
        it('interpolates internalPercent within the stage range', async () => {
            const runner = await makeRunner();
            runner.setStage('Running'); // range [10, 90]
            runner.updateStageProgress(50); // midpoint → 10 + (90-10)*0.5 = 50

            // finish() drains all pending void flushes before its own final DB write
            await runner.finish('Success');

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const meta = JSON.parse(call.data.metadata);
            expect(meta.progress).toBe(50);
        });

        it('clamps internalPercent to 0-100 range', async () => {
            const runner = await makeRunner();
            runner.setStage('Running'); // range [10, 90]
            runner.updateStageProgress(150); // clamped to 100 → max of range = 90

            await runner.finish('Success');

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const meta = JSON.parse(call.data.metadata);
            expect(meta.progress).toBe(90);
        });
    });

    describe('logEntry()', () => {
        it('adds a log entry with the current stage', async () => {
            const runner = await makeRunner();
            runner.setStage('Running');
            runner.logEntry('Processing file', 'info');

            // finish() ensures all pending void flushes complete before writing final state
            await runner.finish('Success');

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const logs = JSON.parse(call.data.logs);
            const entry = logs.find((l: { message: string }) => l.message === 'Processing file');
            expect(entry).toBeDefined();
            expect(entry.stage).toBe('Running');
            expect(entry.level).toBe('info');
        });

        it('includes optional details in the log entry', async () => {
            const runner = await makeRunner();
            runner.logEntry('Command output', 'info', 'command', 'line1\nline2');

            await runner.flushLogs(true);

            const call = prismaMock.execution.update.mock.calls.at(-1)![0];
            const logs = JSON.parse(call.data.logs);
            const entry = logs.find((l: { message: string }) => l.message === 'Command output');
            expect(entry.details).toBe('line1\nline2');
        });
    });

    describe('flushLogs()', () => {
        it('persists current logs and metadata to the database', async () => {
            const runner = await makeRunner();
            runner.logEntry('Test log');

            await runner.flushLogs(true);

            expect(prismaMock.execution.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'exec-1' },
                    data: expect.objectContaining({
                        logs: expect.stringContaining('Test log'),
                        metadata: expect.any(String),
                    }),
                })
            );
        });

        it('skips flush when called within 1 second and force is false', async () => {
            const runner = await makeRunner();

            await runner.flushLogs(true); // forced flush, sets lastLogFlush to now
            const callCount = prismaMock.execution.update.mock.calls.length;

            await runner.flushLogs(false); // within 1s, should skip

            expect(prismaMock.execution.update.mock.calls.length).toBe(callCount);
        });
    });
});
