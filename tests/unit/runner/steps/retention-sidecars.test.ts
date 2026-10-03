import { describe, it, expect, vi } from 'vitest';
import { FileInfo, StorageAdapter } from '@/lib/core/interfaces';
import { loadBackupSidecars, TIMESTAMP_DRIFT_WARNING_MS } from '@/lib/runner/steps/retention-sidecars';

const MTIME = new Date('2026-06-08T12:00:00Z');

const backup = (name: string, mtime: Date = MTIME): FileInfo => ({
    name,
    path: `/job/${name}`,
    size: 1024,
    lastModified: mtime,
});

const sidecar = (name: string): FileInfo => ({
    name: `${name}.meta.json`,
    path: `/job/${name}.meta.json`,
    size: 200,
    lastModified: MTIME,
});

/**
 * A read() that records how many calls are in flight at once, which is the only way to
 * tell a batched loader from a sequential one from the outside.
 */
function trackingAdapter(
    contentFor: (remotePath: string) => string | null | Promise<string | null>,
    readConcurrency?: number
) {
    const state = { inFlight: 0, peak: 0, calls: [] as string[] };
    const adapter = {
        readConcurrency,
        read: vi.fn(async (_config: unknown, remotePath: string) => {
            state.calls.push(remotePath);
            state.inFlight++;
            state.peak = Math.max(state.peak, state.inFlight);
            try {
                // Yield so concurrent calls genuinely overlap rather than resolving inline.
                await new Promise((resolve) => setTimeout(resolve, 1));
                return await contentFor(remotePath);
            } finally {
                state.inFlight--;
            }
        }),
    } as unknown as StorageAdapter;
    return { adapter, state };
}

describe('loadBackupSidecars', () => {
    describe('concurrency', () => {
        it('runs at most the declared number of reads at once', async () => {
            const backups = Array.from({ length: 20 }, (_, i) => backup(`b${i}.sql`));
            const listing = [...backups, ...backups.map((b) => sidecar(b.name))];
            const { adapter, state } = trackingAdapter(() => '{}', 8);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(state.calls).toHaveLength(20);
            expect(state.peak).toBeLessThanOrEqual(8);
            expect(state.peak).toBeGreaterThan(1);
        });

        it('stays sequential for an adapter that declares nothing', async () => {
            const backups = Array.from({ length: 6 }, (_, i) => backup(`b${i}.sql`));
            const listing = [...backups, ...backups.map((b) => sidecar(b.name))];
            const { adapter, state } = trackingAdapter(() => '{}');

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(state.calls).toHaveLength(6);
            expect(state.peak).toBe(1);
        });

        it('treats a declared 0 as sequential rather than as no reads at all', async () => {
            const backups = [backup('a.sql')];
            const listing = [...backups, sidecar('a.sql')];
            const { adapter, state } = trackingAdapter(() => '{}', 0);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(state.calls).toHaveLength(1);
            expect(state.peak).toBe(1);
        });
    });

    describe('skipping reads the listing already rules out', () => {
        it('does not read a sidecar the listing does not contain', async () => {
            const backups = [backup('has-meta.sql'), backup('no-meta.sql')];
            const listing = [...backups, sidecar('has-meta.sql')];
            const { adapter, state } = trackingAdapter(() => '{}', 8);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(state.calls).toEqual(['/job/has-meta.sql.meta.json']);
        });

        it('falls back to trying every backup when the listing reports no sidecars at all', async () => {
            // An adapter whose list() filters sidecars out must not silently lose lock and
            // chain detection, so an empty sidecar set disables the optimisation.
            const backups = [backup('a.sql'), backup('b.sql')];
            const { adapter, state } = trackingAdapter(() => '{}', 8);

            await loadBackupSidecars(adapter, {}, backups, backups);

            expect(state.calls).toHaveLength(2);
        });

        it('does nothing at all for an adapter without read()', async () => {
            const backups = [backup('a.sql')];

            const result = await loadBackupSidecars({} as StorageAdapter, {}, backups, backups);

            expect(result).toEqual({ withTimestamp: 0, drifted: [] });
            expect(backups[0].backupTimestamp).toBeUndefined();
        });
    });

    describe('metadata applied to the file', () => {
        it('sets locked and chainId from the sidecar', async () => {
            const backups = [backup('a.sql'), backup('b.sql')];
            const listing = [...backups, sidecar('a.sql'), sidecar('b.sql')];
            const { adapter } = trackingAdapter((p) =>
                p.includes('a.sql')
                    ? JSON.stringify({ locked: true })
                    : JSON.stringify({ chain: { id: 'chain-1' } })
            , 8);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].locked).toBe(true);
            expect(backups[1].chainId).toBe('chain-1');
        });

        it('takes the job that made a backup from its sidecar', async () => {
            const backups = [backup('a.sql'), backup('b.sql'), backup('c.sql')];
            const listing = [...backups, ...backups.map((b) => sidecar(b.name))];
            const { adapter } = trackingAdapter((p) =>
                p.includes('a.sql') ? JSON.stringify({ jobId: 'job-1' })
                    : p.includes('b.sql') ? JSON.stringify({ jobId: 42 })
                    : JSON.stringify({ jobId: '' })
            , 8);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].jobId).toBe('job-1');
            // Anything but a job id leaves the backup without one, so it counts as the job's own.
            expect(backups[1].jobId).toBeUndefined();
            expect(backups[2].jobId).toBeUndefined();
        });

        it('takes a valid timestamp as the backup creation time', async () => {
            const backups = [backup('a.sql')];
            const listing = [...backups, sidecar('a.sql')];
            const { adapter } = trackingAdapter(() =>
                JSON.stringify({ timestamp: '2026-06-08T11:30:00.000Z' })
            , 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].backupTimestamp?.toISOString()).toBe('2026-06-08T11:30:00.000Z');
            expect(result.withTimestamp).toBe(1);
        });

        it('leaves the timestamp unset when the sidecar has none', async () => {
            const backups = [backup('a.sql')];
            const listing = [...backups, sidecar('a.sql')];
            const { adapter } = trackingAdapter(() => JSON.stringify({ locked: false }), 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].backupTimestamp).toBeUndefined();
            expect(result.withTimestamp).toBe(0);
        });

        it('rejects an unparsable timestamp instead of storing an Invalid Date', async () => {
            // An Invalid Date poisons every comparison it takes part in and would sort
            // unpredictably against real dates.
            const backups = [backup('a.sql')];
            const listing = [...backups, sidecar('a.sql')];
            const { adapter } = trackingAdapter(() => JSON.stringify({ timestamp: 'not a date' }), 8);

            await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].backupTimestamp).toBeUndefined();
        });
    });

    describe('failures are contained', () => {
        it('a throwing read leaves the other backups annotated', async () => {
            const backups = [backup('bad.sql'), backup('good.sql')];
            const listing = [...backups, sidecar('bad.sql'), sidecar('good.sql')];
            const { adapter } = trackingAdapter((p) => {
                if (p.includes('bad.sql')) throw new Error('network');
                return JSON.stringify({ timestamp: '2026-06-08T11:00:00.000Z' });
            }, 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(backups[0].backupTimestamp).toBeUndefined();
            expect(backups[1].backupTimestamp?.toISOString()).toBe('2026-06-08T11:00:00.000Z');
            expect(result.withTimestamp).toBe(1);
        });

        it('malformed JSON is treated as no sidecar', async () => {
            const backups = [backup('a.sql')];
            const listing = [...backups, sidecar('a.sql')];
            const { adapter } = trackingAdapter(() => '{ not json', 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(result.withTimestamp).toBe(0);
            expect(backups[0].backupTimestamp).toBeUndefined();
        });
    });

    describe('drift reporting', () => {
        it('reports a backup whose mtime disagrees with its recorded time', async () => {
            const recorded = new Date(MTIME.getTime() - TIMESTAMP_DRIFT_WARNING_MS - 1000);
            const backups = [backup('moved.sql')];
            const listing = [...backups, sidecar('moved.sql')];
            const { adapter } = trackingAdapter(() =>
                JSON.stringify({ timestamp: recorded.toISOString() })
            , 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(result.drifted).toHaveLength(1);
            expect(result.drifted[0].file.name).toBe('moved.sql');
            expect(result.drifted[0].recorded.toISOString()).toBe(recorded.toISOString());
            expect(result.drifted[0].modified.toISOString()).toBe(MTIME.toISOString());
        });

        it('stays quiet for the normal small gap between upload and mtime', async () => {
            const recorded = new Date(MTIME.getTime() - 30_000);
            const backups = [backup('normal.sql')];
            const listing = [...backups, sidecar('normal.sql')];
            const { adapter } = trackingAdapter(() =>
                JSON.stringify({ timestamp: recorded.toISOString() })
            , 8);

            const result = await loadBackupSidecars(adapter, {}, listing, backups);

            expect(result.drifted).toEqual([]);
            expect(result.withTimestamp).toBe(1);
        });
    });

    it('matches sidecars for paths listed with backslashes', async () => {
        // local.ts builds paths with path.relative, which yields backslashes on Windows.
        const file: FileInfo = { name: 'a.sql', path: 'job\\a.sql', size: 10, lastModified: MTIME };
        const meta: FileInfo = { name: 'a.sql.meta.json', path: 'job\\a.sql.meta.json', size: 10, lastModified: MTIME };
        const { adapter, state } = trackingAdapter(() => JSON.stringify({ locked: true }), 8);

        await loadBackupSidecars(adapter, {}, [file, meta], [file]);

        expect(state.calls).toHaveLength(1);
        expect(file.locked).toBe(true);
    });
});
