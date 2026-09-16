import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepExecuteDump } from '@/lib/runner/steps/02-dump';
import { RunnerContext } from '@/lib/runner/types';

const mockExecuteCombinedDump = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/runner/steps/combined-dump', () => ({
    executeCombinedDump: (...args: unknown[]) => mockExecuteCombinedDump(...args),
}));

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        job: { id: 'job-1', name: 'Job', source: { adapterId: 'mysql' } },
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        sources: [],
        ...overrides,
    } as unknown as RunnerContext;
}

describe('stepExecuteDump', () => {
    beforeEach(() => vi.clearAllMocks());

    it('writes a seekable archive for a job that backs up databases only', async () => {
        const ctx = makeCtx({ sourceAdapter: { id: 'mysql' } as never });

        await stepExecuteDump(ctx);

        expect(mockExecuteCombinedDump).toHaveBeenCalledWith(ctx);
    });

    it('writes a seekable archive for a job with directory sources', async () => {
        const ctx = makeCtx({ sourceAdapter: { id: 'mysql' } as never, sources: [{ jobSourceId: 'js-1' }] as never });

        await stepExecuteDump(ctx);

        expect(mockExecuteCombinedDump).toHaveBeenCalledWith(ctx);
    });

    it('writes a seekable archive for a job with directory sources and no database', async () => {
        const ctx = makeCtx({ job: { id: 'job-1', name: 'Files', source: null } as never, sources: [{ jobSourceId: 'js-1' }] as never });

        await stepExecuteDump(ctx);

        expect(mockExecuteCombinedDump).toHaveBeenCalledTimes(1);
    });

    it('throws when the context is not initialized', async () => {
        await expect(stepExecuteDump(makeCtx({ job: undefined }))).rejects.toThrow('Context not initialized');
    });

    it('throws when the job has neither a database nor directory sources', async () => {
        await expect(stepExecuteDump(makeCtx())).rejects.toThrow('Job has no source configured');
        expect(mockExecuteCombinedDump).not.toHaveBeenCalled();
    });
});
