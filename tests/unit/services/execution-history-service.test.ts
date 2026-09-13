import { describe, it, expect, beforeEach, type Mock } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import {
    buildExecutionHistoryWhere,
    listExecutionHistory,
    normalizeHistoryPageSize,
    SYSTEM_TASK_TYPES,
} from '@/services/system/execution-history-service';

describe('buildExecutionHistoryWhere()', () => {
    it('keeps system task types out of the activity scope', () => {
        const where = buildExecutionHistoryWhere({ scope: 'activity' });
        expect(where).toEqual({ AND: [{ type: { notIn: [...SYSTEM_TASK_TYPES] } }] });
    });

    it('limits the system scope to system task types', () => {
        const where = buildExecutionHistoryWhere({ scope: 'system' });
        expect(where).toEqual({ AND: [{ type: { in: [...SYSTEM_TASK_TYPES] } }] });
    });

    it('returns every execution when no scope or filter is given', () => {
        expect(buildExecutionHistoryWhere({})).toEqual({});
    });

    it('matches any of several statuses and triggers', () => {
        const where = buildExecutionHistoryWhere({
            statuses: ['Success', 'Failed'],
            triggers: ['Manual', ' Api '],
        });
        expect(where).toEqual({
            AND: [
                { status: { in: ['Success', 'Failed'] } },
                { triggerType: { in: ['Manual', 'Api'] } },
            ],
        });
    });

    it('ignores empty filter values', () => {
        const where = buildExecutionHistoryWhere({ types: ['', '  '], statuses: [], search: '   ' });
        expect(where).toEqual({});
    });

    it('searches the job name in the activity scope', () => {
        const where = buildExecutionHistoryWhere({ scope: 'activity', search: 'prod' });
        expect(where.AND).toContainEqual({ job: { is: { name: { contains: 'prod' } } } });
    });

    it('searches the execution type in the system scope', () => {
        const where = buildExecutionHistoryWhere({ scope: 'system', search: 'Integrity' });
        expect(where.AND).toContainEqual({ type: { contains: 'Integrity' } });
    });

    it('searches both job name and type when no scope is given', () => {
        const where = buildExecutionHistoryWhere({ search: 'x' });
        expect(where.AND).toContainEqual({
            OR: [
                { job: { is: { name: { contains: 'x' } } } },
                { type: { contains: 'x' } },
            ],
        });
    });
});

describe('normalizeHistoryPageSize()', () => {
    it('falls back to the default for missing or invalid values', () => {
        expect(normalizeHistoryPageSize(undefined)).toBe(100);
        expect(normalizeHistoryPageSize(0)).toBe(100);
        expect(normalizeHistoryPageSize(-5)).toBe(100);
        expect(normalizeHistoryPageSize(NaN)).toBe(100);
    });

    it('caps oversized requests so a poll never loads the whole table', () => {
        expect(normalizeHistoryPageSize(5000)).toBe(100);
        expect(normalizeHistoryPageSize(20)).toBe(20);
    });
});

describe('listExecutionHistory()', () => {
    beforeEach(() => {
        prismaMock.execution.findMany.mockResolvedValue([]);
        prismaMock.execution.count.mockResolvedValue(0);
    });

    it('reads the requested page without the log column', async () => {
        await listExecutionHistory({ page: 3, pageSize: 20, scope: 'activity' });

        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                skip: 40,
                take: 20,
                orderBy: { startedAt: 'desc' },
                select: expect.not.objectContaining({ logs: true }),
            })
        );
    });

    it('counts with the same filters as the page so older entries stay reachable', async () => {
        prismaMock.execution.findMany.mockResolvedValue([{ id: 'e1' }] as any);
        prismaMock.execution.count.mockResolvedValue(350);

        const result = await listExecutionHistory({ page: 1, pageSize: 10, statuses: ['Failed'] });

        const where = { AND: [{ status: { in: ['Failed'] } }] };
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
        expect(prismaMock.execution.count).toHaveBeenCalledWith({ where });
        expect(result.total).toBe(350);
        expect(result.data).toEqual([{ id: 'e1' }]);
    });

    it('treats a missing or invalid page as the first one', async () => {
        await listExecutionHistory({ page: 0, pageSize: 10 });
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });
});

describe('getExecutionHistoryFacets()', () => {
    it('counts each column without its own filter but with the others', async () => {
        const { getExecutionHistoryFacets } = await import('@/services/system/execution-history-service');
        // The deep mock's groupBy generic is too wide for vitest to resolve, hence the cast.
        const groupBy = prismaMock.execution.groupBy as unknown as Mock;
        groupBy.mockImplementation((async (args: any) => {
            const col = args.by[0];
            if (col === 'status') return [{ status: 'Success', _count: { _all: 7 } }, { status: 'Failed', _count: { _all: 2 } }];
            if (col === 'type') return [{ type: 'Backup', _count: { _all: 9 } }];
            return [{ triggerType: null, _count: { _all: 1 } }, { triggerType: 'Manual', _count: { _all: 8 } }];
        }) as any);

        const facets = await getExecutionHistoryFacets({ scope: 'activity', statuses: ['Failed'], triggers: ['Manual'] });

        expect(facets).toEqual({
            type: { Backup: 9 },
            status: { Success: 7, Failed: 2 },
            trigger: { Manual: 8 },
        });

        const calls = groupBy.mock.calls.map((c: any) => c[0]);
        const statusCall = calls.find((c: any) => c.by[0] === 'status');
        expect(statusCall.where.AND).not.toContainEqual({ status: { in: ['Failed'] } });
        expect(statusCall.where.AND).toContainEqual({ triggerType: { in: ['Manual'] } });
        const triggerCall = calls.find((c: any) => c.by[0] === 'triggerType');
        expect(triggerCall.where.AND).toContainEqual({ status: { in: ['Failed'] } });
        expect(triggerCall.where.AND).not.toContainEqual({ triggerType: { in: ['Manual'] } });
    });
});
