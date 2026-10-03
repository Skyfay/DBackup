import { describe, it, expect, vi } from 'vitest';
import { runBulk, summarizeBulkResult, emptyBulkResult, countNoun, describeBulkFailures, type BulkLabels } from '@/lib/core/bulk';

const jobLabels: BulkLabels = { verb: 'delete', verbPast: 'deleted', noun: 'job' };

describe('runBulk', () => {
    it('reports every id as succeeded when nothing throws', async () => {
        const result = await runBulk(['a', 'b', 'c'], async () => { });

        expect(result.succeeded).toEqual(['a', 'b', 'c']);
        expect(result.failed).toEqual([]);
    });

    // The whole point of the helper: one bad row must not cost the user the other nine.
    it('keeps processing after a failure instead of aborting the batch', async () => {
        const seen: string[] = [];

        const result = await runBulk(['a', 'b', 'c'], async (id) => {
            seen.push(id);
            if (id === 'b') throw new Error('b is in use');
        });

        expect(seen).toEqual(['a', 'b', 'c']);
        expect(result.succeeded).toEqual(['a', 'c']);
        expect(result.failed).toEqual([{ id: 'b', name: undefined, error: 'b is in use' }]);
    });

    it('records the failure reason so the user can act on it', async () => {
        const result = await runBulk(['x'], async () => {
            throw new Error('Cannot delete the last SuperAdmin user.');
        });

        expect(result.failed[0].error).toBe('Cannot delete the last SuperAdmin user.');
    });

    it('attaches a display name to failures when one is available', async () => {
        const names: Record<string, string> = { 'id-1': 'Nightly Prod' };

        const result = await runBulk(['id-1'], async () => { throw new Error('nope'); }, (id) => names[id]);

        expect(result.failed[0].name).toBe('Nightly Prod');
    });

    it('runs sequentially rather than fanning out', async () => {
        const order: string[] = [];

        await runBulk(['a', 'b'], async (id) => {
            order.push(`start-${id}`);
            await Promise.resolve();
            order.push(`end-${id}`);
        });

        expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
    });

    it('does nothing for an empty batch', async () => {
        const fn = vi.fn();

        const result = await runBulk([], fn);

        expect(fn).not.toHaveBeenCalled();
        expect(result).toEqual(emptyBulkResult());
    });
});

describe('summarizeBulkResult', () => {
    it('reports a clean batch with the past tense', () => {
        const summary = summarizeBulkResult({ succeeded: ['a', 'b'], failed: [] }, jobLabels);
        expect(summary).toBe('2 jobs deleted');
    });

    it('uses the singular for exactly one success', () => {
        const summary = summarizeBulkResult({ succeeded: ['a'], failed: [] }, jobLabels);
        expect(summary).toBe('1 job deleted');
    });

    it('names both halves of a partial batch', () => {
        const summary = summarizeBulkResult(
            { succeeded: ['a', 'b'], failed: [{ id: 'c', error: 'in use' }] },
            jobLabels
        );
        expect(summary).toBe('2 of 3 jobs deleted');
    });

    it('switches to the infinitive when nothing succeeded', () => {
        const summary = summarizeBulkResult(
            { succeeded: [], failed: [{ id: 'a', error: 'in use' }, { id: 'b', error: 'in use' }] },
            jobLabels
        );
        expect(summary).toBe('Could not delete 2 jobs');
    });

    it('uses the singular for a single total failure', () => {
        const summary = summarizeBulkResult({ succeeded: [], failed: [{ id: 'a', error: 'in use' }] }, jobLabels);
        expect(summary).toBe('Could not delete 1 job');
    });

    it('respects an irregular plural', () => {
        const summary = summarizeBulkResult(
            { succeeded: ['a', 'b'], failed: [] },
            { verb: 'delete', verbPast: 'deleted', noun: 'entry', nounPlural: 'entries' }
        );
        expect(summary).toBe('2 entries deleted');
    });

    it('handles an empty result', () => {
        expect(summarizeBulkResult(emptyBulkResult(), jobLabels)).toBe('No jobs deleted');
    });
});

describe('countNoun', () => {
    it('names one entry in the singular and several in the plural', () => {
        expect(countNoun(1, jobLabels)).toBe('1 job');
        expect(countNoun(7, jobLabels)).toBe('7 jobs');
        expect(countNoun(2, { ...jobLabels, noun: 'retention policy', nounPlural: 'retention policies' })).toBe('2 retention policies');
    });
});

describe('describeBulkFailures', () => {
    const failure = (id: string) => ({ id, error: 'in use' });

    it('names what failed and how the rest went', () => {
        expect(describeBulkFailures({ succeeded: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], failed: [failure('h')] }, jobLabels)).toEqual({
            title: '1 job was not deleted',
            note: '7 of 8 deleted',
        });
    });

    it('says so when nothing went through', () => {
        expect(describeBulkFailures({ succeeded: [], failed: [failure('a'), failure('b')] }, jobLabels)).toEqual({
            title: '2 jobs were not deleted',
            note: 'Nothing was deleted',
        });
    });
});
