import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { JobService } from '@/services/jobs/job-service';
import { scheduler } from '@/lib/server/scheduler';

vi.mock('@/lib/server/scheduler', () => ({
    scheduler: {
        refresh: vi.fn().mockResolvedValue(undefined)
    }
}));

const trash = vi.hoisted(() => ({ keepInTrash: vi.fn(async () => 'trash-1') }));
vi.mock('@/services/trash/trash-snapshot', () => trash);

describe('JobService bulk operations', () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
        prismaMock.job.findMany.mockResolvedValue([
            { id: 'a', name: 'Nightly Prod' },
            { id: 'b', name: 'Weekly Archive' },
            { id: 'c', name: 'Hourly Logs' },
        ] as any);
    });

    describe('deleteJobs', () => {
        it('deletes every requested job', async () => {
            prismaMock.job.delete.mockResolvedValue({} as any);

            const result = await service.deleteJobs(['a', 'b', 'c']);

            expect(result.succeeded).toEqual(['a', 'b', 'c']);
            expect(result.failed).toEqual([]);
            expect(prismaMock.job.delete).toHaveBeenCalledTimes(3);
            expect(trash.keepInTrash).toHaveBeenCalledTimes(3);
        });

        it('skips Recently deleted for jobs deleted permanently', async () => {
            prismaMock.job.delete.mockResolvedValue({} as any);

            await service.deleteJobs(['a', 'b'], { permanently: true });

            expect(prismaMock.job.delete).toHaveBeenCalledTimes(2);
            expect(trash.keepInTrash).not.toHaveBeenCalled();
        });

        // The scheduler re-reads every job on each call, so one refresh reaches the same
        // state as N. A loop over deleteJob would silently reintroduce the N.
        it('refreshes the scheduler exactly once for the whole batch', async () => {
            prismaMock.job.delete.mockResolvedValue({} as any);

            await service.deleteJobs(['a', 'b', 'c']);

            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
        });

        it('does not refresh the scheduler when nothing was deleted', async () => {
            prismaMock.job.delete.mockRejectedValue(new Error('Record not found'));

            const result = await service.deleteJobs(['a', 'b']);

            expect(result.succeeded).toEqual([]);
            expect(scheduler.refresh).not.toHaveBeenCalled();
        });

        it('keeps deleting after one job fails and names the one that did not', async () => {
            prismaMock.job.delete
                .mockResolvedValueOnce({} as any)
                .mockRejectedValueOnce(new Error('Record not found'))
                .mockResolvedValueOnce({} as any);

            const result = await service.deleteJobs(['a', 'b', 'c']);

            expect(result.succeeded).toEqual(['a', 'c']);
            expect(result.failed).toEqual([
                { id: 'b', name: 'Weekly Archive', error: 'Record not found' },
            ]);
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
        });
    });

    describe('setJobsEnabled', () => {
        it('sets an absolute state rather than toggling each job', async () => {
            prismaMock.job.update.mockResolvedValue({} as any);

            await service.setJobsEnabled(['a', 'b'], false);

            expect(prismaMock.job.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { enabled: false } });
            expect(prismaMock.job.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { enabled: false } });
        });

        it('refreshes the scheduler exactly once for the whole batch', async () => {
            prismaMock.job.update.mockResolvedValue({} as any);

            await service.setJobsEnabled(['a', 'b', 'c'], true);

            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
        });

        it('reports the jobs it could not update', async () => {
            prismaMock.job.update
                .mockResolvedValueOnce({} as any)
                .mockRejectedValueOnce(new Error('Record not found'));

            const result = await service.setJobsEnabled(['a', 'b'], true);

            expect(result.succeeded).toEqual(['a']);
            expect(result.failed[0]).toMatchObject({ id: 'b', name: 'Weekly Archive' });
        });
    });
});
