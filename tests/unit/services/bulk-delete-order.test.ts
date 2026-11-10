import { describe, it, expect } from 'vitest';
import {
    groupByChainFolder,
    orderPathsForDelete,
    dependentsOf,
    fileNameOf,
} from '@/services/storage/bulk-delete-order';

// Chain members are named so they sort chronologically, which is what both the ordering
// and the dependency check rely on.
/** A chain folder named like the runner names them, `chain-` and the moment the chain started, here at `hhmm`. */
const folderOf = (hhmm: string) => `backups/nightly/chain-2026-07-15T${hhmm.slice(0, 2)}-${hhmm.slice(2)}-00-000`;
const chain = (hhmm: string, name: string) => `${folderOf(hhmm)}/${name}`;

describe('groupByChainFolder', () => {
    it('collects members of the same chain together', () => {
        const groups = groupByChainFolder([
            chain('1700', 'full-000.tar'),
            chain('1700', 'inc-001.tar'),
        ]);

        expect(groups.get(folderOf('1700'))).toEqual([
            chain('1700', 'full-000.tar'),
            chain('1700', 'inc-001.tar'),
        ]);
    });

    it('keeps two chains apart', () => {
        const groups = groupByChainFolder([
            chain('1700', 'full-000.tar'),
            chain('1800', 'full-000.tar'),
        ]);

        expect(groups.size).toBe(2);
    });

    it('files a flat backup under no chain', () => {
        const groups = groupByChainFolder(['backups/nightly/db-2024.sql.gz']);

        expect(groups.get(null)).toEqual(['backups/nightly/db-2024.sql.gz']);
    });

    it('does not mistake the folder of a job called chain-something for a chain', () => {
        const groups = groupByChainFolder(['tenants/acme/chain-store/db.sql.gz']);

        expect(groups.get(null)).toEqual(['tenants/acme/chain-store/db.sql.gz']);
    });

    it('does not mistake an ordinary folder for a chain', () => {
        const groups = groupByChainFolder(['backups/chainsaw/db.sql.gz']);

        expect(groups.get(null)).toHaveLength(1);
    });
});

describe('orderPathsForDelete', () => {
    // The reason this module exists. Deleting a chain oldest-first would have every
    // member except the last refused for dependents that are also about to be removed.
    it('orders a whole chain newest-first', () => {
        const ordered = orderPathsForDelete([
            chain('1700', 'full-000.tar'),
            chain('1700', 'inc-001.tar'),
            chain('1700', 'inc-002.tar'),
        ]);

        expect(ordered).toEqual([
            chain('1700', 'inc-002.tar'),
            chain('1700', 'inc-001.tar'),
            chain('1700', 'full-000.tar'),
        ]);
    });

    it('reorders a chain that arrives shuffled', () => {
        const ordered = orderPathsForDelete([
            chain('1700', 'inc-001.tar'),
            chain('1700', 'full-000.tar'),
            chain('1700', 'inc-002.tar'),
        ]);

        expect(ordered).toEqual([
            chain('1700', 'inc-002.tar'),
            chain('1700', 'inc-001.tar'),
            chain('1700', 'full-000.tar'),
        ]);
    });

    it('leaves flat backups in the order they were selected', () => {
        const flat = ['backups/b.sql.gz', 'backups/a.sql.gz', 'backups/c.sql.gz'];

        expect(orderPathsForDelete(flat)).toEqual(flat);
    });

    it('orders each chain independently in a mixed batch', () => {
        const ordered = orderPathsForDelete([
            'backups/flat.sql.gz',
            chain('1700', 'full-000.tar'),
            chain('1700', 'inc-001.tar'),
        ]);

        expect(ordered[0]).toBe('backups/flat.sql.gz');
        expect(ordered.slice(1)).toEqual([
            chain('1700', 'inc-001.tar'),
            chain('1700', 'full-000.tar'),
        ]);
    });

    it('orders two interleaved chains without mixing them', () => {
        const ordered = orderPathsForDelete([
            chain('1700', 'full-000.tar'),
            chain('1800', 'full-000.tar'),
            chain('1700', 'inc-001.tar'),
            chain('1800', 'inc-001.tar'),
        ]);

        expect(ordered).toEqual([
            chain('1700', 'inc-001.tar'),
            chain('1700', 'full-000.tar'),
            chain('1800', 'inc-001.tar'),
            chain('1800', 'full-000.tar'),
        ]);
    });

    it('handles an empty batch', () => {
        expect(orderPathsForDelete([])).toEqual([]);
    });
});

describe('dependentsOf', () => {
    const siblings = ['full-000.tar', 'inc-001.tar', 'inc-002.tar'];

    it('names the later snapshots that build on this one', () => {
        expect(dependentsOf(siblings, 'full-000.tar')).toEqual(['inc-001.tar', 'inc-002.tar']);
    });

    it('reports nothing for the newest member', () => {
        expect(dependentsOf(siblings, 'inc-002.tar')).toEqual([]);
    });

    it('ignores sidecars, which depend on nothing', () => {
        expect(dependentsOf([...siblings, 'inc-002.tar.meta.json'], 'inc-002.tar')).toEqual([]);
    });

    // This is what makes deleting a whole chain possible: by the time the oldest member is
    // reached, the newer ones are gone and no longer count against it.
    it('discounts members already removed in this batch', () => {
        const removed = new Set(['inc-001.tar', 'inc-002.tar']);

        expect(dependentsOf(siblings, 'full-000.tar', removed)).toEqual([]);
    });

    // The other half of the same rule: a partial selection must still be refused, since
    // the snapshots left behind would become unrestorable.
    it('still refuses when only part of the chain was selected', () => {
        const removed = new Set(['inc-001.tar']);

        expect(dependentsOf(siblings, 'full-000.tar', removed)).toEqual(['inc-002.tar']);
    });
});

describe('fileNameOf', () => {
    it('takes the last segment', () => {
        expect(fileNameOf('a/b/c.tar')).toBe('c.tar');
    });

    it('normalises Windows separators', () => {
        expect(fileNameOf('a\\b\\c.tar')).toBe('c.tar');
    });

    it('passes through a bare filename', () => {
        expect(fileNameOf('c.tar')).toBe('c.tar');
    });
});
