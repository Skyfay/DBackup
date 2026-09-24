import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { StorageService, CACHE_SCHEMA_VERSION, clearListingState } from '@/services/storage/storage-service';
import { registry } from '@/lib/core/registry';
import type { FileInfo, StorageAdapter } from '@/lib/core/interfaces';

vi.mock('@/lib/crypto', () => ({ decryptConfig: (input: unknown) => input }));
vi.mock('@/lib/core/registry', () => ({ registry: { get: vi.fn() } }));
vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));
vi.mock('@/lib/adapters/config-resolver', () => ({ resolveAdapterConfig: vi.fn().mockResolvedValue({}) }));
vi.mock('@/services/restore/smart-recovery', () => ({ resolveDecryptionKey: vi.fn() }));
vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const destination = { id: 'nas', name: 'NAS', type: 'storage', adapterId: 'sftp', config: '{}', storageRole: 'DESTINATION' };

function adapterWith(list: StorageAdapter['list']): StorageAdapter {
    return { id: 'sftp', type: 'storage', name: 'SFTP', list, read: vi.fn().mockResolvedValue(null) } as unknown as StorageAdapter;
}

function cacheRow(version: number, files: Partial<FileInfo>[] = [{ name: 'old.tar', path: 'old.tar', size: 1 }], cachedAt = new Date()) {
    return { adapterConfigId: 'nas', filesJson: JSON.stringify({ v: version, files }), cachedAt } as never;
}

describe('listings of a destination that does not always answer', () => {
    let service: StorageService;

    beforeEach(() => {
        service = new StorageService();
        clearListingState();
        prismaMock.adapterConfig.findUnique.mockResolvedValue(destination as never);
        prismaMock.job.findMany.mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([]);
        prismaMock.storageListCache.upsert.mockResolvedValue({} as never);
    });

    it('asks the storage once when a page, Check now and the warmup task want the same listing', async () => {
        let finish!: (files: FileInfo[]) => void;
        const list = vi.fn(() => new Promise<FileInfo[]>((resolve) => { finish = resolve; }));
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(null);

        const first = service.listDestinationFiles('nas', true);
        const second = service.listDestinationFiles('nas', true);
        await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
        finish([]);

        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(list).toHaveBeenCalledTimes(1);
    });

    it('remembers a failed listing and leaves the destination alone for a while, unless asked to check now', async () => {
        const list = vi.fn().mockRejectedValue(new Error('Timed out while waiting for handshake'));
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(null);

        expect(service.refreshInBackground('nas', 'rebuild')).toBe(true);
        await vi.waitFor(() => expect(service.isListing('nas')).toBe(false));
        expect(service.listingFailure('nas')?.error).toBe('Timed out while waiting for handshake');

        // A page load right after does not ask the storage again.
        expect(service.refreshInBackground('nas', 'rebuild')).toBe(false);
        expect(list).toHaveBeenCalledTimes(1);

        // Check now does.
        await expect(service.checkNow('nas')).resolves.toBe(true);
        await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });

    it('clears the failure once the destination answers again', async () => {
        const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(null);

        await expect(service.listDestinationFiles('nas', true)).rejects.toThrow('offline');
        expect(service.listingFailure('nas')).not.toBeNull();

        await service.listDestinationFiles('nas', true);
        expect(service.listingFailure('nas')).toBeNull();
    });

    it('serves the list of an older version at once and replaces it in the background', async () => {
        const list = vi.fn().mockResolvedValue([]);
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(cacheRow(CACHE_SCHEMA_VERSION - 1));

        const { files } = await service.listDestinationFiles('nas');

        expect(files.map((file) => file.name)).toEqual(['old.tar']);
        await vi.waitFor(() => expect(prismaMock.storageListCache.upsert).toHaveBeenCalled());
    });

    it('keeps the old list when the rebuild of an unreachable destination fails', async () => {
        vi.mocked(registry.get).mockReturnValue(adapterWith(vi.fn().mockRejectedValue(new Error('NT_STATUS_IO_TIMEOUT'))));
        prismaMock.storageListCache.findUnique.mockResolvedValue(cacheRow(CACHE_SCHEMA_VERSION - 1));

        await service.listDestinationFiles('nas');
        await vi.waitFor(() => expect(service.listingFailure('nas')).not.toBeNull());

        expect(prismaMock.storageListCache.deleteMany).not.toHaveBeenCalled();
        await expect(service.readCachedListing('nas')).resolves.toMatchObject({ current: false, files: [expect.objectContaining({ name: 'old.tar' })] });
    });

    it('drops a list too old to read and lists the destination again', async () => {
        const list = vi.fn().mockResolvedValue([]);
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(cacheRow(1));

        await service.listDestinationFiles('nas');

        expect(prismaMock.storageListCache.deleteMany).toHaveBeenCalled();
        expect(list).toHaveBeenCalled();
    });

    it('keeps the version of an older list it patches, so the rebuild still happens', async () => {
        prismaMock.storageListCache.findUnique.mockResolvedValue(cacheRow(CACHE_SCHEMA_VERSION - 1));
        prismaMock.storageListCache.update.mockResolvedValue({} as never);

        await service.appendStorageListCacheEntry('nas', { name: 'new.tar', path: 'new.tar', size: 2, lastModified: new Date() });

        const written = JSON.parse(prismaMock.storageListCache.update.mock.calls[0][0].data.filesJson as string);
        expect(written.v).toBe(CACHE_SCHEMA_VERSION - 1);
        expect(written.files.map((file: FileInfo) => file.name)).toEqual(['old.tar', 'new.tar']);
    });

    it('lists at most four destinations at once in the background and queues the rest', async () => {
        const finishers: Array<() => void> = [];
        const list = vi.fn(() => new Promise<FileInfo[]>((resolve) => { finishers.push(() => resolve([])); }));
        vi.mocked(registry.get).mockReturnValue(adapterWith(list));
        prismaMock.storageListCache.findUnique.mockResolvedValue(null);

        for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) service.refreshInBackground(id, 'rebuild');

        await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(4));
        expect(service.isListing('f')).toBe(true);

        finishers.shift()!();
        await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(5));
    });
});
