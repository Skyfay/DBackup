import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

const storage = vi.hoisted(() => ({
    readCachedListing: vi.fn(),
    refreshInBackground: vi.fn(),
    isListing: vi.fn(),
    listingFailure: vi.fn(),
    checkNow: vi.fn(),
    listDestinationFiles: vi.fn(),
}));

vi.mock('@/services/storage/storage-service', () => ({
    storageService: storage,
    isListingStale: (listedAt: Date) => Date.now() - listedAt.getTime() > 2 * 3_600_000,
}));
vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { StorageExplorerService } from '@/services/storage/explorer-service';

const destination = (id: string, lastStatus = 'ONLINE') => ({ id, name: id.toUpperCase(), adapterId: 'sftp', lastStatus, lastHealthCheck: new Date(), lastError: null });
const file = { name: 'a.tar', path: 'Shop/a.tar', size: 10, lastModified: new Date(), jobId: 'job-1', jobName: 'Shop', createdAt: new Date().toISOString() };

describe('the Storage Explorer never waits for a storage', () => {
    let service: StorageExplorerService;

    beforeEach(() => {
        service = new StorageExplorerService();
        prismaMock.job.findMany.mockResolvedValue([
            { id: 'job-1', name: 'Shop', backupMode: 'FULL', source: { adapterId: 'postgres', name: 'Shop' }, sources: [], destinations: [{ configId: 'nas' }] },
        ] as never);
        storage.isListing.mockReturnValue(false);
        storage.listingFailure.mockReturnValue(null);
        storage.refreshInBackground.mockReturnValue(true);
    });

    it('reads only what the cache holds and lists what is missing in the background', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination('nas'), destination('sftp')] as never);
        storage.readCachedListing.mockImplementation(async (id: string) =>
            id === 'nas' ? { files: [file], listedAt: new Date(), current: true } : null);
        storage.isListing.mockImplementation((id: string) => id === 'sftp');

        const index = await service.getIndex();

        expect(storage.listDestinationFiles).not.toHaveBeenCalled();
        expect(storage.refreshInBackground).toHaveBeenCalledTimes(1);
        expect(storage.refreshInBackground).toHaveBeenCalledWith('sftp', 'rebuild');
        expect(index.destinations.find((entry) => entry.id === 'nas')).toMatchObject({ count: 1, listing: false });
        expect(index.destinations.find((entry) => entry.id === 'sftp')).toMatchObject({ count: 0, listedAt: null, listing: true });
    });

    it('rebuilds a list of an older version and compares an old one, but shows both at once', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination('nas'), destination('r2')] as never);
        const old = new Date(Date.now() - 3 * 3_600_000);
        storage.readCachedListing.mockImplementation(async (id: string) =>
            id === 'nas' ? { files: [file], listedAt: new Date(), current: false } : { files: [file], listedAt: old, current: true });

        const index = await service.getIndex();

        expect(storage.refreshInBackground).toHaveBeenCalledWith('nas', 'rebuild');
        expect(storage.refreshInBackground).toHaveBeenCalledWith('r2', 'reconcile');
        expect(index.destinations.map((entry) => entry.count)).toEqual([1, 1]);
    });

    it('leaves an offline destination to the hourly task and says why its list is old', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination('smb', 'OFFLINE')] as never);
        storage.readCachedListing.mockResolvedValue(null);
        storage.listingFailure.mockReturnValue({ at: new Date(), error: 'NT_STATUS_IO_TIMEOUT' });

        const index = await service.getIndex();

        expect(storage.refreshInBackground).not.toHaveBeenCalled();
        expect(index.destinations[0]).toMatchObject({ listError: 'NT_STATUS_IO_TIMEOUT', listing: false, health: { status: 'OFFLINE' } });
    });

    it('tells how long the last connection check took and when an offline destination last answered', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination('nas'), destination('r2', 'OFFLINE')] as never);
        storage.readCachedListing.mockResolvedValue(null);
        const lastAnswer = new Date('2026-09-24T05:00:00Z');
        prismaMock.healthCheckLog.findFirst.mockImplementation((async (args: { where: { adapterConfigId: string; status?: string } }) => {
            if (args.where.status === 'ONLINE') return { createdAt: lastAnswer };
            return { latencyMs: args.where.adapterConfigId === 'nas' ? 12 : 10_000 };
        }) as never);

        const index = await service.getIndex();

        expect(index.destinations.find((entry) => entry.id === 'nas')?.health).toMatchObject({ status: 'ONLINE', latencyMs: 12, answeredAt: null });
        expect(index.destinations.find((entry) => entry.id === 'r2')?.health).toMatchObject({ status: 'OFFLINE', answeredAt: lastAnswer.toISOString() });
    });

    it('checks only destinations it knows', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: 'nas' }] as never);
        storage.checkNow.mockResolvedValue(true);

        await expect(service.checkNow(['nas', 'unknown'])).resolves.toEqual(['nas']);
        expect(storage.checkNow).toHaveBeenCalledTimes(1);
        expect(storage.checkNow).toHaveBeenCalledWith('nas');
    });
});

describe('every backup in one list', () => {
    let service: StorageExplorerService;

    beforeEach(() => {
        service = new StorageExplorerService();
        prismaMock.job.findMany.mockResolvedValue([
            { id: 'job-1', name: 'Shop', backupMode: 'FULL', source: { adapterId: 'postgres', name: 'Shop' }, sources: [], destinations: [{ configId: 'nas' }, { configId: 'r2' }] },
            { id: 'job-2', name: 'CRM', backupMode: 'FULL', source: { adapterId: 'mysql', name: 'CRM' }, sources: [], destinations: [{ configId: 'nas' }] },
        ] as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination('nas'), destination('r2')] as never);
        storage.isListing.mockReturnValue(false);
        storage.listingFailure.mockReturnValue(null);
    });

    it('lists the backups of every job newest first, each with its copy at every destination', async () => {
        const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
        const shop = { name: 'shop.tar', path: 'Shop/shop.tar', size: 10, lastModified: new Date(), jobId: 'job-1', jobName: 'Shop', createdAt: at(3) };
        const crm = { name: 'crm.tar', path: 'CRM/crm.tar', size: 5, lastModified: new Date(), jobId: 'job-2', jobName: 'CRM', createdAt: at(1) };
        storage.readCachedListing.mockImplementation(async (id: string) =>
            ({ files: id === 'nas' ? [shop, crm] : [shop], listedAt: new Date(), current: true }));

        const { runs } = await service.getBackups();

        expect(runs.map((run) => run.path)).toEqual(['CRM/crm.tar', 'Shop/shop.tar']);
        expect(runs[1].copies.map((copy) => [copy.destinationId, copy.state])).toEqual([['nas', 'stored'], ['r2', 'stored']]);
        expect(runs[0].jobKey).toBe('job-2');
    });

    it('finds the run that made a backup under either way History wrote its path', async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            { id: 'old', status: 'Success', startedAt: new Date('2026-09-20T03:00:00Z'), endedAt: null, path: '/Shop/shop.tar' },
            { id: 'new', status: 'Partial', startedAt: new Date('2026-09-24T03:00:00Z'), endedAt: new Date('2026-09-24T03:02:00Z'), path: 'Shop/shop.tar' },
        ] as never);

        await expect(service.getExecution('/Shop/shop.tar')).resolves.toMatchObject({ id: 'new', status: 'Partial' });
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { path: { in: ['Shop/shop.tar', '/Shop/shop.tar'] } } }));
    });

    it('has no run for a backup History no longer holds', async () => {
        prismaMock.execution.findMany.mockResolvedValue([]);

        await expect(service.getExecution('Shop/gone.tar')).resolves.toBeNull();
    });
});
