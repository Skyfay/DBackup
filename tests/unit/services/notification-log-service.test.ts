import { describe, it, expect, type Mock } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import {
    recordNotificationLog,
    getNotificationLogs,
    getNotificationLogById,
    buildNotificationLogWhere,
    getNotificationLogFacets,
    getNotificationStats,
    getNotificationFilterOptions,
    type NotificationLogEntry,
} from '@/services/notifications/notification-log-service';

const baseEntry: NotificationLogEntry = {
    eventType: 'backup.completed',
    channelId: 'ch-1',
    channelName: 'Discord #alerts',
    adapterId: 'discord',
    status: 'Success',
    title: 'Backup completed',
    message: 'Job finished successfully',
};

describe('recordNotificationLog()', () => {
    it('creates a notification log record with required fields', async () => {
        prismaMock.notificationLog.create.mockResolvedValue({} as any);

        await recordNotificationLog(baseEntry);

        expect(prismaMock.notificationLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'backup.completed',
                channelName: 'Discord #alerts',
                adapterId: 'discord',
                status: 'Success',
                title: 'Backup completed',
                message: 'Job finished successfully',
            }),
        });
    });

    it('serialises fields array to JSON string', async () => {
        prismaMock.notificationLog.create.mockResolvedValue({} as any);

        const entry: NotificationLogEntry = {
            ...baseEntry,
            fields: [{ name: 'Duration', value: '2s' }],
        };

        await recordNotificationLog(entry);

        expect(prismaMock.notificationLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                fields: JSON.stringify([{ name: 'Duration', value: '2s' }]),
            }),
        });
    });

    it('stores null for optional fields when not provided', async () => {
        prismaMock.notificationLog.create.mockResolvedValue({} as any);

        await recordNotificationLog(baseEntry);

        expect(prismaMock.notificationLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                fields: null,
                color: null,
                renderedHtml: null,
                renderedPayload: null,
                error: null,
                executionId: null,
            }),
        });
    });

    it('does not throw when prisma create fails', async () => {
        prismaMock.notificationLog.create.mockRejectedValue(new Error('DB down'));

        await expect(recordNotificationLog(baseEntry)).resolves.toBeUndefined();
    });

    it('stores failed notification with error message', async () => {
        prismaMock.notificationLog.create.mockResolvedValue({} as any);

        const failedEntry: NotificationLogEntry = {
            ...baseEntry,
            status: 'Failed',
            error: 'Connection refused',
        };

        await recordNotificationLog(failedEntry);

        expect(prismaMock.notificationLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                status: 'Failed',
                error: 'Connection refused',
            }),
        });
    });
});

describe('getNotificationLogs()', () => {
    const mockLogs = [{ id: 'log-1', adapterId: 'discord', status: 'Success' }];

    it('returns paginated logs with defaults', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue(mockLogs as any);
        prismaMock.notificationLog.count.mockResolvedValue(1);

        const result = await getNotificationLogs();

        expect(result.data).toEqual(mockLogs);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(50);
    });

    it('applies adapterId filter', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ adapterId: 'slack' });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ adapterId: 'slack' }) })
        );
    });

    it('applies status filter', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ status: 'Failed' });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ status: 'Failed' }) })
        );
    });

    it('matches any of several adapters when the filter is a list', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ adapterId: ['slack', 'discord'] });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ adapterId: { in: ['slack', 'discord'] } }) })
        );
    });

    it('ignores an empty filter list', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ adapterId: [], status: [''] });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: {} })
        );
    });

    it('searches the title', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ search: '  nightly ' });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ title: { contains: 'nightly' } }) })
        );
    });

    it('caps the page size at 100', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        const result = await getNotificationLogs({ page: 2, pageSize: 1000 });

        expect(result.pageSize).toBe(100);
        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 100, take: 100 })
        );
    });

    it('applies eventType filter', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        await getNotificationLogs({ eventType: 'backup.completed' });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ eventType: 'backup.completed' }) })
        );
    });

    it('respects custom page and pageSize', async () => {
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        prismaMock.notificationLog.count.mockResolvedValue(0);

        const result = await getNotificationLogs({ page: 3, pageSize: 10 });

        expect(prismaMock.notificationLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 20, take: 10 })
        );
        expect(result.page).toBe(3);
        expect(result.pageSize).toBe(10);
    });
});

describe('getNotificationLogById()', () => {
    it('calls findUnique with the provided id', async () => {
        const mockLog = { id: 'log-42' };
        prismaMock.notificationLog.findUnique.mockResolvedValue(mockLog as any);

        const result = await getNotificationLogById('log-42');

        expect(prismaMock.notificationLog.findUnique).toHaveBeenCalledWith({ where: { id: 'log-42' } });
        expect(result).toEqual(mockLog);
    });

    it('returns null when log is not found', async () => {
        prismaMock.notificationLog.findUnique.mockResolvedValue(null);

        const result = await getNotificationLogById('missing-id');

        expect(result).toBeNull();
    });
});

describe('the notifications of the History page', () => {
    const groupBy = prismaMock.notificationLog.groupBy as unknown as Mock;

    it('filters by the name a channel had when the message went out', () => {
        expect(buildNotificationLogWhere({ channelName: ['Discord #ops', 'Telegram Manu'] })).toEqual({ channelName: { in: ['Discord #ops', 'Telegram Manu'] } });
    });

    it('counts the channels and events beside their filters, each under the other filters', async () => {
        groupBy.mockReset();
        groupBy
            .mockResolvedValueOnce([{ adapterId: 'discord', _count: { _all: 2 } }])
            .mockResolvedValueOnce([{ status: 'Failed', _count: { _all: 1 } }])
            .mockResolvedValueOnce([{ channelName: 'Discord #ops', _count: { _all: 2 } }])
            .mockResolvedValueOnce([{ eventType: 'backup_failure', _count: { _all: 2 } }]);
        const facets = await getNotificationLogFacets({ channelName: 'Discord #ops' });
        expect(facets.channelName).toEqual({ 'Discord #ops': 2 });
        expect(facets.eventType).toEqual({ backup_failure: 2 });
        expect(groupBy.mock.calls[2][0].where).toEqual({});
    });

    it('counts the last 30 days with the last channel that failed', async () => {
        groupBy.mockReset();
        groupBy
            .mockResolvedValueOnce([{ status: 'Success', _count: { _all: 40 } }, { status: 'Failed', _count: { _all: 2 } }])
            .mockResolvedValueOnce([{ channelName: 'Discord #ops', _count: { _all: 30 } }, { channelName: 'Telegram Manu', _count: { _all: 12 } }])
            .mockResolvedValueOnce([{ eventType: 'backup_success', _count: { _all: 30 } }, { eventType: 'backup_failure', _count: { _all: 12 } }]);
        prismaMock.notificationLog.findFirst.mockResolvedValue({ channelName: 'Telegram Manu', sentAt: new Date('2026-09-27T04:07:14.000Z') } as never);
        expect(await getNotificationStats(new Date('2026-09-27T10:00:00.000Z'))).toEqual({
            sent: 40, failed: 2, lastFailed: { channelName: 'Telegram Manu', at: '2026-09-27T04:07:14.000Z' }, channels: ['Discord #ops', 'Telegram Manu'], events: 2,
        });
    });

    it('lists every channel and event there is for the filters', async () => {
        groupBy.mockReset();
        groupBy
            .mockResolvedValueOnce([{ channelName: 'Telegram Manu', adapterId: 'telegram', _count: { _all: 1 } }, { channelName: 'Discord #ops', adapterId: 'discord', _count: { _all: 1 } }])
            .mockResolvedValueOnce([{ eventType: 'user_login', _count: { _all: 1 } }, { eventType: 'backup_failure', _count: { _all: 1 } }]);
        expect(await getNotificationFilterOptions()).toEqual({
            channels: [{ name: 'Discord #ops', adapterId: 'discord' }, { name: 'Telegram Manu', adapterId: 'telegram' }],
            events: ['backup_failure', 'user_login'],
        });
    });
});
