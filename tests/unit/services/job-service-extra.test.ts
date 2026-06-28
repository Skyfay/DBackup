import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { JobService } from '@/services/jobs/job-service';
import { scheduler } from '@/lib/server/scheduler';

vi.mock('@/lib/server/scheduler', () => ({
    scheduler: {
        refresh: vi.fn().mockResolvedValue(undefined)
    }
}));

describe('JobService (extra coverage)', () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // createJob - notificationTemplateIds path (line 126)
    // -------------------------------------------------------------------------
    describe('createJob - notificationTemplateIds', () => {
        it('should create notificationTemplates relation entries when notificationTemplateIds is provided', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.job.create.mockResolvedValue({ id: 'job-tmpl' } as any);

            await service.createJob({
                name: 'Template Job',
                schedule: '0 0 * * *',
                sourceId: 'src-1',
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                notificationTemplateIds: ['tmpl-1', 'tmpl-2'],
            });

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        notificationTemplates: {
                            create: [
                                { templateId: 'tmpl-1', priority: 0 },
                                { templateId: 'tmpl-2', priority: 1 },
                            ],
                        },
                    }),
                })
            );
        });

        it('should pass undefined for notificationTemplates when notificationTemplateIds is an empty array', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.job.create.mockResolvedValue({ id: 'job-no-tmpl' } as any);

            await service.createJob({
                name: 'No Template Job',
                schedule: '0 0 * * *',
                sourceId: 'src-1',
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                notificationTemplateIds: [],
            });

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        notificationTemplates: expect.anything(),
                    }),
                })
            );
        });
    });

    // -------------------------------------------------------------------------
    // updateJob - notification template deleteMany + createMany (lines 177-180)
    // -------------------------------------------------------------------------
    describe('updateJob - notificationTemplateIds', () => {
        it('should delete existing templates and create new ones when notificationTemplateIds is provided', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.jobNotificationTemplate.deleteMany.mockResolvedValue({ count: 2 } as any);
            prismaMock.jobNotificationTemplate.createMany.mockResolvedValue({ count: 2 } as any);
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', {
                notificationTemplateIds: ['tmpl-a', 'tmpl-b'],
            });

            expect(prismaMock.jobNotificationTemplate.deleteMany).toHaveBeenCalledWith({
                where: { jobId: 'job-1' },
            });
            expect(prismaMock.jobNotificationTemplate.createMany).toHaveBeenCalledWith({
                data: [
                    { jobId: 'job-1', templateId: 'tmpl-a', priority: 0 },
                    { jobId: 'job-1', templateId: 'tmpl-b', priority: 1 },
                ],
            });
        });

        it('should delete existing templates but not call createMany when notificationTemplateIds is empty', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.jobNotificationTemplate.deleteMany.mockResolvedValue({ count: 1 } as any);
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', {
                notificationTemplateIds: [],
            });

            expect(prismaMock.jobNotificationTemplate.deleteMany).toHaveBeenCalledWith({
                where: { jobId: 'job-1' },
            });
            expect(prismaMock.jobNotificationTemplate.createMany).not.toHaveBeenCalled();
        });

        it('should not touch notification templates when notificationTemplateIds is undefined', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', { name: 'Renamed' });

            expect(prismaMock.jobNotificationTemplate.deleteMany).not.toHaveBeenCalled();
            expect(prismaMock.jobNotificationTemplate.createMany).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // cloneJob - notificationTemplates undefined branch (line 273)
    // -------------------------------------------------------------------------
    describe('cloneJob - empty notificationTemplates', () => {
        it('should pass undefined for notificationTemplates when original has no templates', async () => {
            const originalJob = {
                id: 'job-1',
                name: 'Empty Templates Job',
                schedule: '0 3 * * *',
                sourceId: 'src-1',
                databases: '[]',
                encryptionProfileId: null,
                compression: 'NONE',
                pgCompression: '',
                notificationEvents: 'ALWAYS',
                schedulePresetId: null,
                notifications: [],
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                notificationTemplates: [],
            };

            prismaMock.job.findUnique.mockResolvedValue(originalJob as any);
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.job.create.mockResolvedValue({ id: 'cloned' } as any);

            await service.cloneJob('job-1');

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        notificationTemplates: expect.anything(),
                    }),
                })
            );
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
        });

        it('should clone notificationTemplates when original has templates', async () => {
            const originalJob = {
                id: 'job-1',
                name: 'Templates Job',
                schedule: '0 3 * * *',
                sourceId: 'src-1',
                databases: '[]',
                encryptionProfileId: null,
                compression: 'NONE',
                pgCompression: '',
                notificationEvents: 'ALWAYS',
                schedulePresetId: null,
                notifications: [],
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                notificationTemplates: [
                    { templateId: 'tmpl-1', priority: 0 },
                    { templateId: 'tmpl-2', priority: 1 },
                ],
            };

            prismaMock.job.findUnique.mockResolvedValue(originalJob as any);
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.job.create.mockResolvedValue({ id: 'cloned' } as any);

            await service.cloneJob('job-1');

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        notificationTemplates: {
                            create: [
                                { templateId: 'tmpl-1', priority: 0 },
                                { templateId: 'tmpl-2', priority: 1 },
                            ],
                        },
                    }),
                })
            );
        });
    });
});
