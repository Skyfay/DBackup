import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

const storage = vi.hoisted(() => ({
    reconcileStorageListCache: vi.fn(),
    listFilesWithMetadata: vi.fn(),
}));

vi.mock('@/services/storage/storage-service', () => ({ storageService: storage }));
vi.mock('@/lib/core/registry', () => ({ registry: { get: vi.fn() } }));
vi.mock('@/services/system/update-service', () => ({ updateService: { checkForUpdates: vi.fn() } }));
vi.mock('@/services/notifications/system-notification-service', () => ({ notify: vi.fn(), getNotificationConfig: vi.fn() }));
vi.mock('@/services/databases/database-list-service', () => ({ databaseListService: {} }));

import { warmupStorageCache } from '@/services/system/system-task-runs';

const usb = { id: 'usb', name: 'USB rotation', type: 'storage', storageRole: 'DESTINATION', metadata: JSON.stringify({ airGapped: true }) };
const nas = { id: 'nas', name: 'NAS', type: 'storage', storageRole: 'DESTINATION', metadata: null, lastStatus: 'ONLINE' };

describe('the warmup of the storage lists', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.storageListCache.findUnique.mockResolvedValue({ adapterConfigId: 'x' } as never);
        storage.reconcileStorageListCache.mockResolvedValue(undefined);
    });

    it('leaves out an air-gapped destination that is not connected', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ ...usb, lastStatus: 'OFFLINE' }, nas] as never);

        await expect(warmupStorageCache()).resolves.toEqual({ summary: '1 destination' });
        expect(storage.reconcileStorageListCache).toHaveBeenCalledTimes(1);
        expect(storage.reconcileStorageListCache).toHaveBeenCalledWith('nas');
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
});
