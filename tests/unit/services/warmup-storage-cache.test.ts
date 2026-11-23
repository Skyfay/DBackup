import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

const storage = vi.hoisted(() => ({
    reconcileStorageListCache: vi.fn(),
    listFilesWithMetadata: vi.fn(),
}));

vi.mock('@/services/storage/storage-service', () => ({ storageService: storage }));
// Whether a tenant may still use a destination, which the sharing module reads across tenants.
const access = vi.hoisted(() => ({ viewModeOf: vi.fn() }));
vi.mock('@/services/sharing/destination-access', () => access);
// Who a destination is shared with, and the folders deleted tenants left on it. Nobody gets one unless a test says so.
const sharing = vi.hoisted(() => ({ customersOfShares: vi.fn(), sweepDeletedTenantFolders: vi.fn() }));
vi.mock('@/services/sharing/provided', () => ({ customersOfShares: (...args: unknown[]) => sharing.customersOfShares(...args) }));
vi.mock('@/services/sharing/share-cleanup', () => ({ sweepDeletedTenantFolders: (...args: unknown[]) => sharing.sweepDeletedTenantFolders(...args) }));
vi.mock('@/lib/core/registry', () => ({ registry: { get: vi.fn() } }));
vi.mock('@/services/system/update-service', () => ({ updateService: { checkForUpdates: vi.fn() } }));
vi.mock('@/services/notifications/system-notification-service', () => ({ notify: vi.fn(), getNotificationConfig: vi.fn() }));
vi.mock('@/services/databases/database-list-service', () => ({ databaseListService: {} }));
// Whether a destination reaches the own data of DBackup, see `own-data.ts`. None does unless a test says so.
const ownData = vi.hoisted(() => ({ storedScanRefusal: vi.fn() }));
vi.mock('@/lib/adapters/own-data', () => ({ storedScanRefusal: (...args: unknown[]) => ownData.storedScanRefusal(...args) }));

import { warmupStorageCache } from '@/services/system/system-task-runs';
import { explicitScope } from '@/lib/tenant/context';

const usb = { id: 'usb', name: 'USB rotation', type: 'storage', storageRole: 'DESTINATION', metadata: JSON.stringify({ airGapped: true }), tenantId: 'acme' };
const nas = { id: 'nas', name: 'NAS', type: 'storage', storageRole: 'DESTINATION', metadata: null, lastStatus: 'ONLINE', tenantId: 'acme' };

describe('the warmup of the storage lists', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Every destination has a listing of its own tenant already, so the warmup compares it.
        prismaMock.storageListCache.findMany.mockImplementation((async (args: { where: { adapterConfigId: { in: string[] } } }) =>
            args.where.adapterConfigId.in.map((adapterConfigId) => ({ adapterConfigId, tenantId: 'acme' }))) as never);
        storage.reconcileStorageListCache.mockResolvedValue(undefined);
        ownData.storedScanRefusal.mockResolvedValue(null);
        access.viewModeOf.mockImplementation(async (_row: unknown, tenantId: string) => ({ kind: 'customer', tenantId }));
        sharing.customersOfShares.mockResolvedValue(new Map());
        sharing.sweepDeletedTenantFolders.mockResolvedValue([]);
    });

    it('never lists a destination whose folder reaches the own data of DBackup, and drops what was cached of it', async () => {
        const data = { ...nas, id: 'data', name: 'Data' };
        prismaMock.adapterConfig.findMany.mockResolvedValue([data, nas] as never);
        prismaMock.storageListCache.deleteMany.mockResolvedValue({ count: 1 } as never);
        ownData.storedScanRefusal.mockImplementation(async (row: { id: string }) => (row.id === 'data' ? "This path reaches the folder of DBackup's own database." : null));

        await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });
        expect(storage.reconcileStorageListCache).toHaveBeenCalledTimes(1);
        expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('nas', 'acme');
        expect(prismaMock.storageListCache.deleteMany).toHaveBeenCalledWith({ where: { adapterConfigId: { in: ['data'] } } });
    });

    it('leaves out an air-gapped destination that is not connected', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ ...usb, lastStatus: 'OFFLINE' }, nas] as never);

        await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });
        expect(storage.reconcileStorageListCache).toHaveBeenCalledTimes(1);
        expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('nas', 'acme');
    });

    it('does not count an air-gapped destination unplugged since its last check as a failure', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ ...usb, lastStatus: 'ONLINE' }, nas] as never);
        storage.reconcileStorageListCache.mockImplementation(async (id: string) => {
            if (id === 'usb') throw new Error('ENOENT');
        });

        await expect(warmupStorageCache()).resolves.toEqual({ summary: '2 destinations' });
    });

    it('still counts a destination that is not air-gapped as failed', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([nas] as never);
        storage.reconcileStorageListCache.mockRejectedValue(new Error('timeout'));

        await expect(warmupStorageCache()).resolves.toEqual({ ok: false, summary: '1 of 1 destination failed' });
    });

    describe('of a destination its tenant shares with customers', () => {
        const shared = { ...nas, id: 'msp-s3', name: 'MSP S3', tenantId: 'msp' };

        beforeEach(() => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([shared] as never);
            // The listing of the MSP and the one of its customer Globex.
            prismaMock.storageListCache.findMany.mockResolvedValue([
                { adapterConfigId: 'msp-s3', tenantId: 'msp' },
                { adapterConfigId: 'msp-s3', tenantId: 'globex' },
            ] as never);
            prismaMock.storageListCache.deleteMany.mockResolvedValue({ count: 1 } as never);
        });

        it('compares the listing of each customer that still has the destination', async () => {
            await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });

            expect(access.viewModeOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'msp-s3', tenantId: 'msp' }), 'globex');
            expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('msp-s3', 'msp');
            expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('msp-s3', 'globex');
            expect(prismaMock.storageListCache.deleteMany).not.toHaveBeenCalled();
        });

        it('drops the listing of a customer the destination is no longer shared with, without listing it', async () => {
            access.viewModeOf.mockResolvedValue(null);

            await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });

            expect(prismaMock.storageListCache.deleteMany).toHaveBeenCalledWith({ where: { adapterConfigId: 'msp-s3', tenantId: 'globex' } });
            expect(storage.reconcileStorageListCache).toHaveBeenCalledTimes(1);
            expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('msp-s3', 'msp');
        });

        it('keeps the listing of a customer when the storage does not answer for a moment', async () => {
            storage.reconcileStorageListCache.mockRejectedValue(new Error('ETIMEDOUT'));

            // The destination failed once, however many of its listings did.
            await expect(warmupStorageCache()).resolves.toEqual({ ok: false, summary: '1 of 1 destination failed' });

            expect(prismaMock.storageListCache.deleteMany).not.toHaveBeenCalled();
        });

        it('lists the destination for a customer it is shared with that has no listing yet, in the scope of that customer', async () => {
            sharing.customersOfShares.mockResolvedValue(new Map([['msp-s3', ['globex', 'initech']]]));
            const scopes: unknown[] = [];
            storage.listFilesWithMetadata.mockImplementation(async () => {
                scopes.push(explicitScope());
                return [];
            });

            await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });

            // Globex has a listing and compares it, Initech never opened the destination.
            expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('msp-s3', 'globex');
            expect(storage.listFilesWithMetadata).toHaveBeenCalledTimes(1);
            expect(storage.listFilesWithMetadata).toHaveBeenCalledWith('msp-s3');
            expect(scopes).toEqual([{ kind: 'tenant', tenantId: 'initech' }]);
            expect(access.viewModeOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'msp-s3' }), 'initech');
        });

        it('lists a customer once, whether it has a listing or not', async () => {
            sharing.customersOfShares.mockResolvedValue(new Map([['msp-s3', ['globex']]]));

            await warmupStorageCache();

            expect(storage.reconcileStorageListCache.mock.calls.filter(([, tenantId]) => tenantId === 'globex')).toHaveLength(1);
            expect(storage.listFilesWithMetadata).not.toHaveBeenCalled();
        });

        it('deletes the folders of deleted tenants on a shared destination before the listings', async () => {
            sharing.customersOfShares.mockResolvedValue(new Map([['msp-s3', []]]));
            const order: string[] = [];
            sharing.sweepDeletedTenantFolders.mockImplementation(async () => {
                order.push('sweep');
                return ['gone'];
            });
            storage.reconcileStorageListCache.mockImplementation(async () => {
                order.push('reconcile');
            });

            await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });

            expect(sharing.sweepDeletedTenantFolders).toHaveBeenCalledWith('msp-s3');
            expect(order[0]).toBe('sweep');
        });

        it('sweeps no destination nobody shares, and counts a sweep the storage refuses as failed', async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([shared, nas] as never);
            sharing.customersOfShares.mockResolvedValue(new Map([['msp-s3', ['globex']]]));
            sharing.sweepDeletedTenantFolders.mockRejectedValue(new Error('EACCES'));

            await expect(warmupStorageCache()).resolves.toEqual({ ok: false, summary: '1 of 2 destinations failed' });

            expect(sharing.sweepDeletedTenantFolders).toHaveBeenCalledTimes(1);
            expect(sharing.sweepDeletedTenantFolders).toHaveBeenCalledWith('msp-s3');
            // The listings go on anyway.
            expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('msp-s3', 'globex');
        });

        it('keeps the listing of a customer when its access cannot be read', async () => {
            access.viewModeOf.mockRejectedValue(new Error('database is locked'));

            await expect(warmupStorageCache()).resolves.toEqual({ ok: false, summary: '1 of 1 destination failed' });

            expect(prismaMock.storageListCache.deleteMany).not.toHaveBeenCalled();
        });
    });
});
