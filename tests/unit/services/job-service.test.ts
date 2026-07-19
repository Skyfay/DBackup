import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { JobService, CreateJobInput } from '@/services/jobs/job-service';
import { scheduler } from '@/lib/server/scheduler';

// Mock the global scheduler singleton to avoid side effects (like starting cron timers)
vi.mock('@/lib/server/scheduler', () => ({
    scheduler: {
        refresh: vi.fn().mockResolvedValue(undefined)
    }
}));

describe('JobService', () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
    });

    describe('createJob', () => {
        it('should create a job and refresh the scheduler', async () => {
            // Arrange
            const input: CreateJobInput = {
                name: 'Test Job',
                schedule: '0 0 * * *',
                sourceId: 'source-1',
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                notificationIds: ['notif-1'],
                enabled: true
            };

            const expectedJob = {
                id: 'new-job-id',
                ...input,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Setup Prisma Mock return value
            // prisma.job.create takes { data: ... }
            prismaMock.job.create.mockResolvedValue(expectedJob as any);

            // Act
            const result = await service.createJob(input);

            // Assert
            // 1. Check if Prisma was called with correct data
            expect(prismaMock.job.create).toHaveBeenCalledWith({
                data: {
                    name: input.name,
                    schedule: input.schedule,
                    sourceId: input.sourceId,
                    databases: "[]",
                    enabled: input.enabled,
                    encryptionProfileId: null,
                    namingTemplateId: null,
                    schedulePresetId: null,
                    compression: "NONE",
                    pgCompression: "",
                    notificationEvents: "ALWAYS",
                    skipVerification: false,
                    notifications: {
                        connect: [{ id: 'notif-1' }]
                    },
                    destinations: {
                        create: [{ configId: 'dest-1', priority: 0, retention: '{}', retentionPolicyId: null }]
                    }
                },
                include: expect.objectContaining({
                    source: true,
                    destinations: expect.any(Object),
                    notifications: true,
                })
            });

            // 2. Check if Scheduler was refreshed
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);

            // 3. Check result
            expect(result).toEqual(expectedJob);
        });

        it('should use default values when optional fields are omitted', async () => {
            prismaMock.job.create.mockResolvedValue({ id: 'job-defaults' } as any);

            await service.createJob({
                name: 'Minimal Job',
                schedule: '0 * * * *',
                sourceId: 'src-1',
                destinations: [{ configId: 'd-1', priority: 1, retention: '' }],
            });

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        enabled: true,
                        compression: 'NONE',
                        notificationEvents: 'ALWAYS',
                        encryptionProfileId: null,
                        namingTemplateId: null,
                        notifications: { connect: [] },
                        destinations: {
                            create: [{ configId: 'd-1', priority: 1, retention: '{}', retentionPolicyId: null }],
                        },
                    }),
                })
            );
        });
    });

    describe('getJobs', () => {
        it('should return list of jobs ordered by creation date', async () => {
            // Arrange
            const mockJobs = [
                { id: '1', name: 'Job 1' },
                { id: '2', name: 'Job 2' }
            ];
            prismaMock.job.findMany.mockResolvedValue(mockJobs as any);

            // Act
            const result = await service.getJobs();

            // Assert
            expect(prismaMock.job.findMany).toHaveBeenCalledWith({
                include: expect.objectContaining({
                    source: true,
                    destinations: expect.any(Object),
                    notifications: true,
                    encryptionProfile: {
                        select: {
                            id: true,
                            name: true,
                        }
                    },
                }),
                orderBy: { createdAt: 'desc' }
            });
            expect(result).toHaveLength(2);
        });
    });

    describe('getJobById', () => {
        it('should return a job when found', async () => {
            const mockJob = { id: 'job-1', name: 'Test Job', source: {}, destinations: [], notifications: [] };
            prismaMock.job.findUnique.mockResolvedValue(mockJob as any);

            const result = await service.getJobById('job-1');

            expect(prismaMock.job.findUnique).toHaveBeenCalledWith({
                where: { id: 'job-1' },
                include: expect.objectContaining({ source: true, notifications: true }),
            });
            expect(result).toEqual(mockJob);
        });

        it('should return null when job does not exist', async () => {
            prismaMock.job.findUnique.mockResolvedValue(null);

            const result = await service.getJobById('missing');

            expect(result).toBeNull();
        });
    });

    describe('createJob - name uniqueness', () => {
        it('should throw when a job with the same name already exists', async () => {
            prismaMock.job.findFirst.mockResolvedValue({ id: 'other', name: 'Duplicate' } as any);

            await expect(
                service.createJob({
                    name: 'Duplicate',
                    schedule: '0 0 * * *',
                    sourceId: 's-1',
                    destinations: [],
                })
            ).rejects.toThrow('A job with the name "Duplicate" already exists.');

            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });
    });

    describe('createJob - sources validation', () => {
        beforeEach(() => {
            // A prior describe block leaves a non-null mockResolvedValue on findFirst
            // (clearAllMocks() only clears call history, not implementations) - reset explicitly.
            prismaMock.job.findFirst.mockResolvedValue(null);
        });

        it('throws when neither sourceId nor sources are provided', async () => {
            await expect(
                service.createJob({
                    name: 'No Source Job',
                    schedule: '0 0 * * *',
                    destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                })
            ).rejects.toThrow('Job must have at least one source');

            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });

        it('creates a directory-only job when sources are provided without a database source', async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'storage-1', name: 'SFTP Server', type: 'storage', usableAsSource: true },
            ] as any);
            prismaMock.job.create.mockResolvedValue({ id: 'dir-only-job' } as any);

            const result = await service.createJob({
                name: 'Directory Only Job',
                schedule: '0 0 * * *',
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                sources: [{ configId: 'storage-1', priority: 0, path: '/data', excludePatterns: ['*.tmp'] }],
            });

            expect(result).toEqual({ id: 'dir-only-job' });
            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        sourceId: null,
                        sources: {
                            create: [{ configId: 'storage-1', priority: 0, path: '/data', excludePatterns: '["*.tmp"]' }],
                        },
                    }),
                })
            );
        });

        it('throws when a directory source adapter is not enabled with the source role', async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'storage-1', name: 'Backup NAS', type: 'storage', usableAsSource: false },
            ] as any);

            await expect(
                service.createJob({
                    name: 'Bad Source Role Job',
                    schedule: '0 0 * * *',
                    destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                    sources: [{ configId: 'storage-1', priority: 0, path: '/data' }],
                })
            ).rejects.toThrow('is not enabled as a directory source');

            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });

        it('throws when combining a database source that does not support directory-source combination', async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'storage-1', name: 'SFTP Server', type: 'storage', usableAsSource: true },
            ] as any);
            // sqlite has no dumpOne capability - not combinable in v1
            prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: 'src-sqlite', adapterId: 'sqlite' } as any);

            await expect(
                service.createJob({
                    name: 'Sqlite Plus Directory Job',
                    schedule: '0 0 * * *',
                    sourceId: 'src-sqlite',
                    destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                    sources: [{ configId: 'storage-1', priority: 0, path: '/data' }],
                })
            ).rejects.toThrow('does not support combined backups with directory sources');

            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });

        it('creates a combined job when the database adapter supports directory-source combination', async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: 'storage-1', name: 'SFTP Server', type: 'storage', usableAsSource: true },
            ] as any);
            // mysql exposes dumpOne - combinable
            prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: 'src-mysql', adapterId: 'mysql' } as any);
            prismaMock.job.create.mockResolvedValue({ id: 'combined-job' } as any);

            const result = await service.createJob({
                name: 'MySQL Plus Directory Job',
                schedule: '0 0 * * *',
                sourceId: 'src-mysql',
                destinations: [{ configId: 'dest-1', priority: 0, retention: '{}' }],
                sources: [{ configId: 'storage-1', priority: 0, path: '/data' }],
            });

            expect(result).toEqual({ id: 'combined-job' });
        });
    });

    describe('updateJob', () => {
        it('should update job fields and refresh the scheduler', async () => {
            const updatedJob = { id: 'job-1', name: 'Renamed', enabled: false };
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.job.update.mockResolvedValue(updatedJob as any);

            const result = await service.updateJob('job-1', { name: 'Renamed', enabled: false });

            expect(prismaMock.job.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'job-1' } })
            );
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
            expect(result).toEqual(updatedJob);
        });

        it('should replace destinations when provided', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.jobDestination.deleteMany.mockResolvedValue({ count: 2 } as any);
            prismaMock.jobDestination.createMany.mockResolvedValue({ count: 1 } as any);
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', {
                destinations: [{ configId: 'dest-2', priority: 0, retention: '{}' }],
            });

            expect(prismaMock.jobDestination.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
            expect(prismaMock.jobDestination.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.arrayContaining([
                        expect.objectContaining({ configId: 'dest-2', jobId: 'job-1' }),
                    ]),
                })
            );
        });

        it('should throw when updated name conflicts with another job', async () => {
            prismaMock.job.findFirst.mockResolvedValue({ id: 'other-job', name: 'Taken' } as any);

            await expect(service.updateJob('job-1', { name: 'Taken' }))
                .rejects.toThrow('A job with the name "Taken" already exists.');
        });

        it('should connect notification channels when notificationIds provided', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', { notificationIds: ['notif-1', 'notif-2'] });

            expect(prismaMock.job.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        notifications: {
                            set: [],
                            connect: [{ id: 'notif-1' }, { id: 'notif-2' }],
                        },
                    }),
                })
            );
        });

        it('should clear encryptionProfileId when empty string is passed', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', { encryptionProfileId: '' });

            expect(prismaMock.job.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ encryptionProfileId: null }),
                })
            );
        });

        it('should serialize databases array and use "{}" default for empty retention', async () => {
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
            prismaMock.jobDestination.deleteMany.mockResolvedValue({ count: 0 } as any);
            prismaMock.jobDestination.createMany.mockResolvedValue({ count: 1 } as any);
            prismaMock.job.update.mockResolvedValue({ id: 'job-1' } as any);

            await service.updateJob('job-1', {
                databases: ['db1', 'db2'],
                destinations: [{ configId: 'd-1', priority: 0, retention: '' }],
            });

            expect(prismaMock.job.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        databases: JSON.stringify(['db1', 'db2']),
                    }),
                })
            );
            expect(prismaMock.jobDestination.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.arrayContaining([
                        expect.objectContaining({ retention: '{}' }),
                    ]),
                })
            );
        });
    });

    describe('deleteJob', () => {
        it('should delete a job and refresh the scheduler', async () => {
            const deletedJob = { id: 'job-1', name: 'Old Job' };
            prismaMock.job.delete.mockResolvedValue(deletedJob as any);

            const result = await service.deleteJob('job-1');

            expect(prismaMock.job.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
            expect(result).toEqual(deletedJob);
        });
    });

    describe('cloneJob', () => {
        const originalJob = {
            id: 'job-1',
            name: 'Production Backup',
            schedule: '0 3 * * *',
            sourceId: 'src-1',
            databases: '["db1"]',
            encryptionProfileId: 'enc-1',
            compression: 'GZIP',
            pgCompression: '',
            notificationEvents: 'ALWAYS',
            schedulePresetId: null,
            notifications: [{ id: 'notif-1' }],
            destinations: [
                { configId: 'dest-1', priority: 0, retention: '{}' },
                { configId: 'dest-2', priority: 1, retention: '{"keep":5}' },
            ],
            sources: [],
        };

        it('throws when the source job is not found', async () => {
            prismaMock.job.findUnique.mockResolvedValue(null);

            await expect(service.cloneJob('missing')).rejects.toThrow('Job with id "missing" not found.');
            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });

        it('uses provided custom name without uniqueness probing', async () => {
            prismaMock.job.findUnique.mockResolvedValue(originalJob as any);
            prismaMock.job.create.mockResolvedValue({ id: 'cloned' } as any);

            await service.cloneJob('job-1', 'My Custom Copy');

            expect(prismaMock.job.findFirst).not.toHaveBeenCalled();
            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        name: 'My Custom Copy',
                        enabled: false,
                        sourceId: 'src-1',
                        encryptionProfileId: 'enc-1',
                        compression: 'GZIP',
                        notifications: { connect: [{ id: 'notif-1' }] },
                        destinations: {
                            create: [
                                { configId: 'dest-1', priority: 0, retention: '{}' },
                                { configId: 'dest-2', priority: 1, retention: '{"keep":5}' },
                            ],
                        },
                    }),
                })
            );
            expect(scheduler.refresh).toHaveBeenCalledTimes(1);
        });

        it('generates "(Copy)" suffix when no name is provided and the base name is free', async () => {
            prismaMock.job.findUnique.mockResolvedValue(originalJob as any);
            prismaMock.job.findFirst.mockResolvedValue(null);
            prismaMock.job.create.mockResolvedValue({ id: 'cloned' } as any);

            await service.cloneJob('job-1');

            expect(prismaMock.job.findFirst).toHaveBeenCalledWith({
                where: { name: 'Production Backup (Copy)' },
            });
            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: 'Production Backup (Copy)' }),
                })
            );
        });

        it('increments counter when "(Copy)" already exists', async () => {
            prismaMock.job.findUnique.mockResolvedValue(originalJob as any);
            prismaMock.job.findFirst
                .mockResolvedValueOnce({ id: 'existing-copy' } as any) // "X (Copy)" exists
                .mockResolvedValueOnce({ id: 'existing-copy-2' } as any) // "X (Copy 2)" exists
                .mockResolvedValueOnce(null); // "X (Copy 3)" is free
            prismaMock.job.create.mockResolvedValue({ id: 'cloned' } as any);

            await service.cloneJob('job-1');

            expect(prismaMock.job.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: 'Production Backup (Copy 3)' }),
                })
            );
        });
    });
});
