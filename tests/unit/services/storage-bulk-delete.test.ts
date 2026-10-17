import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    registryGet: vi.fn(),
    resolveAdapterConfig: vi.fn(),
    listFilesWithMetadata: vi.fn(),
    removeStorageListCacheEntries: vi.fn(),
    updateStorageListCacheEntries: vi.fn(),
    setLockedWith: vi.fn(),
    adapterDelete: vi.fn(),
    adapterList: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    default: {
        adapterConfig: { findUnique: (...a: unknown[]) => mocks.findUnique(...a) },
        // Nobody shares the destination, so its tenant sees it as it is.
        connectionShare: { count: async () => 0 },
    },
}));

vi.mock('@/services/sharing/provided', () => ({ providedConnection: vi.fn().mockResolvedValue(null) }));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: (...a: unknown[]) => mocks.registryGet(...a) },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: (...a: unknown[]) => mocks.resolveAdapterConfig(...a),
}));

vi.mock('@/services/storage/storage-service', () => ({
    storageService: {
        listFilesWithMetadata: (...a: unknown[]) => mocks.listFilesWithMetadata(...a),
        removeStorageListCacheEntries: (...a: unknown[]) => mocks.removeStorageListCacheEntries(...a),
        updateStorageListCacheEntries: (...a: unknown[]) => mocks.updateStorageListCacheEntries(...a),
        setLockedWith: (...a: unknown[]) => mocks.setLockedWith(...a),
    },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}));

const { deleteBackupsBulk, setBackupsLocked } = await import('@/services/storage/bulk-delete');

const file = (path: string, locked = false) => ({ path, name: path.split('/').pop(), locked });
const chain = (name: string) => `backups/nightly/chain-1700/${name}`;

describe('deleteBackupsBulk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue({ id: 'dest-1', type: 'storage', adapterId: 's3', tenantId: 'acme' });
        mocks.registryGet.mockReturnValue({
            delete: (...a: unknown[]) => mocks.adapterDelete(...a),
            list: (...a: unknown[]) => mocks.adapterList(...a),
        });
        mocks.resolveAdapterConfig.mockResolvedValue({ bucket: 'b' });
        mocks.adapterDelete.mockResolvedValue(true);
        mocks.adapterList.mockResolvedValue([]);
        mocks.listFilesWithMetadata.mockResolvedValue([]);
    });

    it('deletes each backup along with its sidecars', async () => {
        mocks.listFilesWithMetadata.mockResolvedValue([file('backups/a.sql.gz')]);

        const result = await deleteBackupsBulk('dest-1', ['backups/a.sql.gz']);

        expect(result.succeeded).toEqual(['backups/a.sql.gz']);
        expect(mocks.adapterDelete).toHaveBeenCalledWith(expect.anything(), 'backups/a.sql.gz');
        expect(mocks.adapterDelete).toHaveBeenCalledWith(expect.anything(), 'backups/a.sql.gz.meta.json');
    });

    // Single deletion has no locked guard at all, so this is the only thing standing
    // between a bulk selection and a backup somebody deliberately protected.
    it('refuses a locked backup and never asks the adapter to remove it', async () => {
        mocks.listFilesWithMetadata.mockResolvedValue([file('backups/a.sql.gz', true)]);

        const result = await deleteBackupsBulk('dest-1', ['backups/a.sql.gz']);

        expect(result.succeeded).toEqual([]);
        expect(result.failed[0].error).toContain('locked');
        expect(mocks.adapterDelete).not.toHaveBeenCalled();
    });

    it('deletes the unlocked backups in a mixed selection', async () => {
        mocks.listFilesWithMetadata.mockResolvedValue([
            file('backups/a.sql.gz'),
            file('backups/b.sql.gz', true),
        ]);

        const result = await deleteBackupsBulk('dest-1', ['backups/a.sql.gz', 'backups/b.sql.gz']);

        expect(result.succeeded).toEqual(['backups/a.sql.gz']);
        expect(result.failed).toHaveLength(1);
    });

    it('treats a provider that reports no deletion as a failure', async () => {
        mocks.listFilesWithMetadata.mockResolvedValue([file('backups/a.sql.gz')]);
        mocks.adapterDelete.mockResolvedValue(false);

        const result = await deleteBackupsBulk('dest-1', ['backups/a.sql.gz']);

        expect(result.succeeded).toEqual([]);
        expect(result.failed).toHaveLength(1);
    });

    it('writes the listing cache once for the whole batch', async () => {
        mocks.listFilesWithMetadata.mockResolvedValue([
            file('backups/a.sql.gz'),
            file('backups/b.sql.gz'),
            file('backups/c.sql.gz'),
        ]);

        await deleteBackupsBulk('dest-1', ['backups/a.sql.gz', 'backups/b.sql.gz', 'backups/c.sql.gz']);

        expect(mocks.removeStorageListCacheEntries).toHaveBeenCalledTimes(1);
        expect(mocks.removeStorageListCacheEntries).toHaveBeenCalledWith('dest-1', [
            'backups/a.sql.gz',
            'backups/b.sql.gz',
            'backups/c.sql.gz',
        ]);
    });

    it('deletes a whole incremental chain rather than refusing every member but the last', async () => {
        const members = ['full-000.tar', 'inc-001.tar', 'inc-002.tar'];
        mocks.listFilesWithMetadata.mockResolvedValue(members.map((m) => file(chain(m))));
        mocks.adapterList.mockResolvedValue(members.map((name) => ({ name })));

        const result = await deleteBackupsBulk('dest-1', members.map(chain));

        expect(result.failed).toEqual([]);
        expect(result.succeeded).toHaveLength(3);
    });

    it('lists a chain folder once instead of once per member', async () => {
        const members = ['full-000.tar', 'inc-001.tar', 'inc-002.tar'];
        mocks.listFilesWithMetadata.mockResolvedValue(members.map((m) => file(chain(m))));
        mocks.adapterList.mockResolvedValue(members.map((name) => ({ name })));

        await deleteBackupsBulk('dest-1', members.map(chain));

        expect(mocks.adapterList).toHaveBeenCalledTimes(1);
    });

    // The guard has to keep working for the case it was written for.
    it('refuses the base of a chain when the later snapshots were not selected', async () => {
        const members = ['full-000.tar', 'inc-001.tar', 'inc-002.tar'];
        mocks.listFilesWithMetadata.mockResolvedValue(members.map((m) => file(chain(m))));
        mocks.adapterList.mockResolvedValue(members.map((name) => ({ name })));

        const result = await deleteBackupsBulk('dest-1', [chain('full-000.tar')]);

        expect(result.succeeded).toEqual([]);
        expect(result.failed[0].error).toContain('incremental chain');
        expect(mocks.adapterDelete).not.toHaveBeenCalled();
    });

    it('does nothing at all for an empty request', async () => {
        const result = await deleteBackupsBulk('dest-1', []);

        expect(result).toEqual({ succeeded: [], failed: [] });
        expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it('refuses the whole batch when the destination cannot be listed', async () => {
        mocks.listFilesWithMetadata.mockRejectedValue(new Error('connection refused'));

        await expect(deleteBackupsBulk('dest-1', ['backups/a.sql.gz'])).rejects.toThrow();
        expect(mocks.adapterDelete).not.toHaveBeenCalled();
    });
});

describe('setBackupsLocked', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue({ id: 'dest-1', type: 'storage', adapterId: 's3', tenantId: 'acme' });
        mocks.registryGet.mockReturnValue({ delete: mocks.adapterDelete, list: mocks.adapterList });
        mocks.resolveAdapterConfig.mockResolvedValue({ bucket: 'b' });
        mocks.setLockedWith.mockResolvedValue(true);
    });

    it('applies the requested state rather than flipping each backup', async () => {
        await setBackupsLocked('dest-1', ['a', 'b'], true);

        expect(mocks.setLockedWith).toHaveBeenCalledWith('dest-1', expect.anything(), expect.anything(), 'a', true, expect.anything());
        expect(mocks.setLockedWith).toHaveBeenCalledWith('dest-1', expect.anything(), expect.anything(), 'b', true, expect.anything());
    });

    it('writes the listing cache once for the whole batch', async () => {
        await setBackupsLocked('dest-1', ['a', 'b', 'c'], true);

        expect(mocks.updateStorageListCacheEntries).toHaveBeenCalledTimes(1);
        expect(mocks.updateStorageListCacheEntries).toHaveBeenCalledWith('dest-1', ['a', 'b', 'c'], { locked: true });
    });

    it('reports the backups it could not change', async () => {
        mocks.setLockedWith
            .mockResolvedValueOnce(true)
            .mockRejectedValueOnce(new Error('Metadata file not found'));

        const result = await setBackupsLocked('dest-1', ['a', 'b'], true);

        expect(result.succeeded).toEqual(['a']);
        expect(result.failed[0].error).toBe('Metadata file not found');
        expect(mocks.updateStorageListCacheEntries).toHaveBeenCalledWith('dest-1', ['a'], { locked: true });
    });
});
