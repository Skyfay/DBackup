/**
 * Shadow copy lifecycle across a backup run.
 *
 * The rule the whole feature stands on: a snapshot created for a run is always released,
 * whether the run succeeds, fails or is cancelled. A leftover consumes space on the file
 * server and blocks the next backup of that share, so the release path matters more than
 * the happy path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerContext } from '@/lib/runner/types';
import type { SnapshotHandle, StorageAdapter } from '@/lib/core/interfaces';
import { stepCleanup } from '@/lib/runner/steps/04-completion';

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

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
        sources: [],
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

function makeHandle(label = '\\\\server\\share@GMT-2026.07.23'): SnapshotHandle {
    return { id: 'set-1|copy-1|\\\\server\\share', configOverride: { address: '//server/snap' }, label };
}

function makeShadow(releaseSnapshot: StorageAdapter['releaseSnapshot'], configName = 'NAS') {
    return {
        configId: 'cfg-1',
        configName,
        adapter: { id: 'smb', releaseSnapshot } as unknown as StorageAdapter,
        config: { address: '//server/share' },
        handle: makeHandle(),
    };
}

describe('stepCleanup - shadow copy release', () => {
    beforeEach(() => vi.clearAllMocks());

    it('releases the snapshot on a successful run', async () => {
        const release = vi.fn().mockResolvedValue(undefined);
        const ctx = makeCtx({ shadowCopies: [makeShadow(release)], status: 'Success' });

        await stepCleanup(ctx);

        expect(release).toHaveBeenCalledWith({ address: '//server/share' }, expect.objectContaining({ id: 'set-1|copy-1|\\\\server\\share' }));
        expect(ctx.shadowCopies).toEqual([]);
    });

    it('releases the snapshot after a failed run', async () => {
        // stepCleanup runs from the runner's finally, so a thrown dump reaches here with
        // the handle still parked on the context.
        const release = vi.fn().mockResolvedValue(undefined);
        const ctx = makeCtx({ shadowCopies: [makeShadow(release)], status: 'Failed' });

        await stepCleanup(ctx);

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases the snapshot after a cancelled run', async () => {
        const release = vi.fn().mockResolvedValue(undefined);
        const ctx = makeCtx({ shadowCopies: [makeShadow(release)], status: 'Cancelled' });

        await stepCleanup(ctx);

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases every snapshot even when one of them fails', async () => {
        // One unreachable server must not strand the snapshot on a second one.
        const failing = vi.fn().mockRejectedValue(new Error('server unreachable'));
        const working = vi.fn().mockResolvedValue(undefined);
        const ctx = makeCtx({ shadowCopies: [makeShadow(failing, 'NAS-A'), makeShadow(working, 'NAS-B')] });

        await stepCleanup(ctx);

        expect(failing).toHaveBeenCalledTimes(1);
        expect(working).toHaveBeenCalledTimes(1);
    });

    it('does not fail the run when a release fails, but says so in the log', async () => {
        const release = vi.fn().mockRejectedValue(new Error('server unreachable'));
        const ctx = makeCtx({ shadowCopies: [makeShadow(release)] });

        await expect(stepCleanup(ctx)).resolves.toBeUndefined();

        const logged = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain('Could not release the shadow copy');
        expect(logged).toContain('server unreachable');
    });

    it('does nothing when the run took no snapshots', async () => {
        const ctx = makeCtx();
        await expect(stepCleanup(ctx)).resolves.toBeUndefined();
    });
});
