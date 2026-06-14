import { describe, it, expect, vi, beforeEach } from 'vitest';
import { integrityService } from '@/services/backup/integrity-service';
import prisma from '@/lib/prisma';
import { registry } from '@/lib/core/registry';
import { verificationService } from '@/services/storage/verification-service';

vi.mock('@/lib/prisma', () => ({
    default: {
        adapterConfig: { findMany: vi.fn() },
        job: { findMany: vi.fn() },
        systemSetting: {
            findUnique: vi.fn().mockImplementation(({ where }: { where: { key: string } }) =>
                Promise.resolve(where.key === 'integrity.scanMode' ? { value: 'destinations' } : null)
            ),
        },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ bucket: 'test' }),
}));

vi.mock('@/services/storage/verification-service', () => ({
    verificationService: {
        verifyFile: vi.fn(),
    },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e) => e),
}));

describe('IntegrityService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: files have no metadata (results in skipped)
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'no_metadata',
            verifiedAt: new Date().toISOString(),
        });
    });

    function makeStorageAdapter(overrides: Record<string, unknown> = {}) {
        return {
            list: vi.fn(),
            download: vi.fn(),
            read: vi.fn(),
            upload: vi.fn(),
            delete: vi.fn(),
            ...overrides,
        };
    }

    it('returns zero counts when no storage destinations exist', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(0);
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.skipped).toBe(0);
    });

    it('skips files without checksum metadata', async () => {
        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Local', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'no_checksum',
            verifiedAt: new Date().toISOString(),
        });

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(1);
        expect(result.skipped).toBe(1);
        expect(result.verified).toBe(0);
    });

    it('passes file that matches checksum', async () => {
        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Local', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'passed',
            verifiedAt: new Date().toISOString(),
        });

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(1);
        expect(result.verified).toBe(1);
        expect(result.passed).toBe(1);
        expect(result.failed).toBe(0);
        expect(result.errors).toHaveLength(0);
    });

    it('records failed file when checksum mismatch', async () => {
        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Storage1', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'failed',
            expectedChecksum: 'sha256:correct',
            actualChecksum: 'sha256:tampered',
            verifiedAt: new Date().toISOString(),
        });

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.failed).toBe(1);
        expect(result.passed).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].file).toBe('backup.sql');
        expect(result.errors[0].destination).toBe('Storage1');
        expect(result.errors[0].expected).toBe('sha256:correct');
        expect(result.errors[0].actual).toBe('sha256:tampered');
    });

    it('falls back to job names when listing storage root fails', async () => {
        const adapter = makeStorageAdapter({
            list: vi.fn()
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockResolvedValueOnce([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Local', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { name: 'Fallback Job' },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await integrityService.runFullIntegrityCheck();

        expect(prisma.job.findMany).toHaveBeenCalled();
        expect(result.totalFiles).toBe(1);
        expect(result.skipped).toBe(1);
    });

    it('skips unknown storage adapter (not in registry)', async () => {
        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's2', adapterId: 'unknown-adapter', name: 'Unknown', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(0);
    });

    it('continues checking other destinations when one throws', async () => {
        const failingAdapter = makeStorageAdapter({
            list: vi.fn().mockRejectedValue(new Error('Storage crash')),
        });
        const passingAdapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'bad', name: 'Bad Storage', config: '{}', primaryCredentialId: null, sshCredentialId: null },
            { id: 's2', adapterId: 'good', name: 'Good Storage', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce(failingAdapter)
            .mockReturnValueOnce(passingAdapter);

        await expect(integrityService.runFullIntegrityCheck()).resolves.not.toThrow();
    });

    it('delegates metadata download fallback to verificationService', async () => {
        const adapter = makeStorageAdapter({
            read: undefined,
            list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
        });

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Local', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'passed',
            verifiedAt: new Date().toISOString(),
        });

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.passed).toBe(1);
    });

    it('accumulates results across multiple destinations', async () => {
        function makePassingAdapter() {
            return makeStorageAdapter({
                list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'backup.sql' }]),
            });
        }

        (prisma.adapterConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 's1', adapterId: 'local', name: 'Dest1', config: '{}', primaryCredentialId: null, sshCredentialId: null },
            { id: 's2', adapterId: 'local', name: 'Dest2', config: '{}', primaryCredentialId: null, sshCredentialId: null },
        ]);
        (registry.get as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce(makePassingAdapter())
            .mockReturnValueOnce(makePassingAdapter());
        vi.mocked(verificationService.verifyFile).mockResolvedValue({
            status: 'passed',
            verifiedAt: new Date().toISOString(),
        });

        const result = await integrityService.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(2);
        expect(result.passed).toBe(2);
    });

    describe('Jobs scan mode (gatherFilesFromJobs)', () => {
        function makeJobWithDest(jobName: string, destConfigId: string, overrides: Record<string, unknown> = {}) {
            return {
                id: `job-${jobName}`,
                name: jobName,
                enabled: true,
                skipVerification: false,
                destinations: [
                    {
                        configId: destConfigId,
                        config: {
                            id: destConfigId,
                            adapterId: 'local',
                            name: `Storage for ${jobName}`,
                            config: '{}',
                            primaryCredentialId: null,
                            sshCredentialId: null,
                            metadata: null,
                        },
                    },
                ],
                ...overrides,
            };
        }

        beforeEach(() => {
            // Switch to jobs mode: no scanMode setting
            vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);
        });

        it('scans job-linked files when scanMode is not set', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([
                    { name: 'backup.sql', path: 'ProdJob/backup.sql' },
                ]),
            });
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('ProdJob', 'dest-1'),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
            vi.mocked(verificationService.verifyFile).mockResolvedValue({
                status: 'passed',
                verifiedAt: new Date().toISOString(),
            });

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(1);
            expect(result.passed).toBe(1);
        });

        it('skips jobs with skipVerification flag', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'SkipJob/backup.sql' }]),
            });
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('SkipJob', 'dest-1', { skipVerification: true }),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(0);
        });

        it('filters out files that do not start with the job name prefix', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([
                    { name: 'mine.sql', path: 'ProdJob/mine.sql' },
                    { name: 'other.sql', path: 'OtherJob/other.sql' },
                ]),
            });
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('ProdJob', 'dest-1'),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
            vi.mocked(verificationService.verifyFile).mockResolvedValue({
                status: 'passed',
                verifiedAt: new Date().toISOString(),
            });

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(1);
        });

        it('excludes .meta.json sidecar files from verification', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([
                    { name: 'backup.sql', path: 'Job/backup.sql' },
                    { name: 'backup.sql.meta.json', path: 'Job/backup.sql.meta.json' },
                ]),
            });
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('Job', 'dest-1'),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
            vi.mocked(verificationService.verifyFile).mockResolvedValue({
                status: 'passed',
                verifiedAt: new Date().toISOString(),
            });

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(1);
        });

        it('deduplicates files when two jobs share the same destination', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([
                    { name: 'job1.sql', path: 'Job1/job1.sql' },
                    { name: 'job2.sql', path: 'Job2/job2.sql' },
                ]),
            });
            const sharedDestId = 'shared-dest';
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('Job1', sharedDestId),
                makeJobWithDest('Job2', sharedDestId),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
            vi.mocked(verificationService.verifyFile).mockResolvedValue({
                status: 'passed',
                verifiedAt: new Date().toISOString(),
            });

            const result = await integrityService.runFullIntegrityCheck();

            // list() called once despite two jobs sharing the destination
            expect(adapter.list).toHaveBeenCalledTimes(1);
            expect(result.totalFiles).toBe(2);
        });

        it('skips destinations with skipVerification set in metadata', async () => {
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([{ name: 'backup.sql', path: 'Job/backup.sql' }]),
            });
            const job = {
                ...makeJobWithDest('Job', 'dest-1'),
                destinations: [
                    {
                        configId: 'dest-1',
                        config: {
                            id: 'dest-1',
                            adapterId: 'local',
                            name: 'Skipped Storage',
                            config: '{}',
                            primaryCredentialId: null,
                            sshCredentialId: null,
                            metadata: JSON.stringify({ skipVerification: true }),
                        },
                    },
                ],
            };
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([job]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(0);
        });

        it('applies maxAgeDays filter in jobs mode', async () => {
            const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
            const recentDate = new Date(Date.now() - 1 * 86_400_000).toISOString();
            const adapter = makeStorageAdapter({
                list: vi.fn().mockResolvedValue([
                    { name: 'old.sql', path: 'Job/old.sql', lastModified: oldDate, size: 100 },
                    { name: 'new.sql', path: 'Job/new.sql', lastModified: recentDate, size: 100 },
                ]),
            });
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
                makeJobWithDest('Job', 'dest-1'),
            ]);
            (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
            // maxAgeDays = 5
            vi.mocked(prisma.systemSetting.findUnique).mockImplementation(({ where }: { where: { key: string } }) => {
                if (where.key === 'integrity.maxAgeDays') return Promise.resolve({ value: '5' } as any);
                return Promise.resolve(null);
            });
            vi.mocked(verificationService.verifyFile).mockResolvedValue({
                status: 'passed',
                verifiedAt: new Date().toISOString(),
            });

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(1);
        });

        it('returns zero results when no jobs exist', async () => {
            (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            const result = await integrityService.runFullIntegrityCheck();

            expect(result.totalFiles).toBe(0);
        });
    });
});
