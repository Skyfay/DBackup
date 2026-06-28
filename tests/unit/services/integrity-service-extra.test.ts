import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { IntegrityService } from '@/services/backup/integrity-service';

// --- Module mocks ---

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (cfg: any) => {
        try { return JSON.parse(cfg.config ?? '{}'); } catch { return {}; }
    }),
}));

vi.mock('@/services/storage/verification-service', () => ({
    verificationService: { verifyFile: vi.fn() },
}));

import { registry } from '@/lib/core/registry';
import { verificationService } from '@/services/storage/verification-service';
import { resolveAdapterConfig } from '@/lib/adapters/config-resolver';

// --- Helpers ---

function makeStorageConfig(overrides: Record<string, any> = {}) {
    return {
        id: 'dest-1',
        name: 'Test Storage',
        adapterId: 'local-fs',
        type: 'storage',
        config: '{}',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function makeStorageAdapter(overrides: Record<string, any> = {}) {
    return {
        list: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function makeCallbacks() {
    return {
        onLog: vi.fn(),
        onStage: vi.fn(),
        onFileProgress: vi.fn(),
    };
}

// Reset system settings to "destinations" scan mode by default.
function mockSettingsDestinations() {
    prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.key === 'integrity.scanMode') return { key: 'integrity.scanMode', value: 'destinations' } as any;
        return null;
    });
}

function mockSettingsJobs() {
    prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.key === 'integrity.scanMode') return null; // null = jobs mode
        return null;
    });
}

// --- Tests for gatherFilesFromJobs paths (lines 224-313) ---

describe('IntegrityService - gatherFilesFromJobs additional paths', () => {
    let service: IntegrityService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new IntegrityService();
        mockSettingsJobs();
    });

    it('logs and skips jobs that have skipVerification set', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'skipped-job',
                skipVerification: true,
                destinations: [],
            },
        ] as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('verification disabled'),
            'info',
        );
        expect(result.totalFiles).toBe(0);
    });

    it('increments scanFailed and continues when adapter not found for a destination in jobs mode', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'job-1',
                skipVerification: false,
                destinations: [
                    { configId: 'dest-1', config: makeStorageConfig({ adapterId: 'unknown-adapter' }) },
                ],
            },
        ] as any);

        vi.mocked(registry.get).mockReturnValue(undefined as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.scanFailed).toBeGreaterThanOrEqual(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining("adapter 'unknown-adapter' not found"),
            'error',
        );
    });

    it('increments scanFailed when resolveAdapterConfig throws in jobs mode', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'job-1',
                skipVerification: false,
                destinations: [
                    { configId: 'dest-1', config: makeStorageConfig() },
                ],
            },
        ] as any);

        vi.mocked(registry.get).mockReturnValue(makeStorageAdapter() as any);
        vi.mocked(resolveAdapterConfig).mockRejectedValueOnce(new Error('Config decrypt failed'));

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.scanFailed).toBeGreaterThanOrEqual(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('config resolution failed'),
            'error',
        );
    });

    it('increments scanFailed when adapter.list throws in jobs mode', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'job-1',
                skipVerification: false,
                destinations: [
                    { configId: 'dest-1', config: makeStorageConfig() },
                ],
            },
        ] as any);

        const adapter = makeStorageAdapter({
            list: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.scanFailed).toBeGreaterThanOrEqual(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('listing failed'),
            'error',
        );
    });

    it('skips destination-level skipVerification in jobs mode', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'job-1',
                skipVerification: false,
                destinations: [
                    {
                        configId: 'dest-1',
                        config: makeStorageConfig({
                            metadata: JSON.stringify({ skipVerification: true }),
                        }),
                    },
                ],
            },
        ] as any);

        vi.mocked(registry.get).mockReturnValue(makeStorageAdapter() as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        // The destination was skipped so list should not have been called.
        expect(registry.get).not.toHaveBeenCalled();
        expect(result.totalFiles).toBe(0);
    });

    it('filters files by maxAgeDays in jobs mode', async () => {
        // Make the setting return a maxAgeDays of 1.
        prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }: any) => {
            if (where.key === 'integrity.maxAgeDays') return { key: 'integrity.maxAgeDays', value: '1' } as any;
            return null;
        });

        const oldDate = new Date(Date.now() - 2 * 86_400_000).toISOString(); // 2 days ago
        const recentDate = new Date(Date.now() - 0.5 * 86_400_000).toISOString(); // 12 h ago

        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'my-job',
                skipVerification: false,
                destinations: [
                    { configId: 'dest-1', config: makeStorageConfig() },
                ],
            },
        ] as any);

        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([
                { name: 'old-backup.sql', path: 'my-job/old-backup.sql', size: 1024, lastModified: oldDate },
                { name: 'new-backup.sql', path: 'my-job/new-backup.sql', size: 1024, lastModified: recentDate },
            ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const result = await service.runFullIntegrityCheck();

        // Only the recent file passes the maxAgeDays=1 filter.
        expect(result.totalFiles).toBe(1);
    });

    it('logs per-job file counts for each eligible job', async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: 'j1',
                name: 'job-a',
                skipVerification: false,
                destinations: [
                    { configId: 'dest-1', config: makeStorageConfig() },
                ],
            },
        ] as any);

        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([
                { name: 'backup1.sql', path: 'job-a/backup1.sql', size: 100, lastModified: null },
                { name: 'backup2.sql', path: 'job-a/backup2.sql', size: 100, lastModified: null },
            ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const callbacks = makeCallbacks();
        await service.runFullIntegrityCheck(callbacks);

        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('job-a: found 2 files to verify'),
        );
    });
});

// --- Tests for gatherFilesFromDestination paths (lines 316-386) ---

describe('IntegrityService - gatherFilesFromDestination additional paths', () => {
    let service: IntegrityService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new IntegrityService();
        mockSettingsDestinations();
    });

    it('skips a destination whose metadata has skipVerification=true (line 323-325)', async () => {
        const skippedConfig = makeStorageConfig({
            metadata: JSON.stringify({ skipVerification: true }),
        });
        prismaMock.adapterConfig.findMany.mockResolvedValue([skippedConfig as any]);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.totalFiles).toBe(0);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('verification disabled'),
            'info',
        );
    });

    it('falls back to per-job folder listing when root list throws (lines 343-360)', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);

        const adapter = makeStorageAdapter({
            list: vi.fn()
                .mockRejectedValueOnce(new Error('Permission denied')) // root listing fails
                .mockResolvedValueOnce([
                    { name: 'backup.sql', path: 'my-job/backup.sql', size: 512, lastModified: null },
                ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);

        // The fallback queries jobs linked to this destination.
        prismaMock.job.findMany.mockResolvedValue([
            { id: 'j1', name: 'my-job' },
        ] as any);

        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const result = await service.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(1);
    });

    it('silently skips unreachable job folders during fallback listing (lines 357-359)', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);

        const adapter = makeStorageAdapter({
            list: vi.fn()
                .mockRejectedValueOnce(new Error('Root unavailable')) // root listing fails
                .mockRejectedValueOnce(new Error('Folder unavailable')), // fallback folder also fails
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);

        prismaMock.job.findMany.mockResolvedValue([
            { id: 'j1', name: 'inaccessible-job' },
        ] as any);

        const result = await service.runFullIntegrityCheck();

        // No crash; scanFailed is not incremented for inner folder errors.
        expect(result.totalFiles).toBe(0);
        expect(result.scanFailed).toBe(0);
    });

    it('applies maxFileSizeMb filter in destinations mode (line 371)', async () => {
        prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }: any) => {
            if (where.key === 'integrity.scanMode') return { key: 'integrity.scanMode', value: 'destinations' } as any;
            if (where.key === 'integrity.maxFileSizeMb') return { key: 'integrity.maxFileSizeMb', value: '1' } as any;
            return null;
        });

        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);

        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([
                { name: 'small.sql', path: 'small.sql', size: 512 * 1024, lastModified: null },
                { name: 'large.sql', path: 'large.sql', size: 10 * 1024 * 1024, lastModified: null },
            ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const result = await service.runFullIntegrityCheck();

        expect(result.totalFiles).toBe(1);
    });

    it('logs singular "file" when exactly one file is found (line 381-383)', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);

        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([
                { name: 'backup.sql', path: 'backup.sql', size: 100, lastModified: null },
            ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const callbacks = makeCallbacks();
        await service.runFullIntegrityCheck(callbacks);

        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('found 1 file to verify'),
        );
    });

    it('increments scanFailed when gatherFilesFromDestination throws unexpectedly (lines 123-127)', async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);

        // Force resolveAdapterConfig to throw so gatherFilesFromDestination propagates an error.
        vi.mocked(resolveAdapterConfig).mockRejectedValueOnce(new Error('Unexpected config error'));
        vi.mocked(registry.get).mockReturnValue(makeStorageAdapter() as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.scanFailed).toBe(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('Failed to scan'),
            'error',
        );
    });
});

// --- Tests for the verification pass (lines 145-193) ---

describe('IntegrityService - verification pass additional paths', () => {
    let service: IntegrityService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new IntegrityService();
        mockSettingsDestinations();

        prismaMock.adapterConfig.findMany.mockResolvedValue([makeStorageConfig() as any]);
        const adapter = makeStorageAdapter({
            list: vi.fn().mockResolvedValue([
                { name: 'backup.sql', path: 'backup.sql', size: 100, lastModified: null },
            ]),
        });
        vi.mocked(registry.get).mockReturnValue(adapter as any);
    });

    it('counts "download_error" status as skipped with appropriate reason label', async () => {
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'download_error' } as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.skipped).toBe(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('download failed'),
            'info',
        );
    });

    it('counts unknown skip status with the raw status string as reason', async () => {
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'some_unknown_status' } as any);

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.skipped).toBe(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('some_unknown_status'),
            'info',
        );
    });

    it('increments skipped and logs when verifyFile throws', async () => {
        vi.mocked(verificationService.verifyFile).mockRejectedValueOnce(new Error('Unexpected I/O error'));

        const callbacks = makeCallbacks();
        const result = await service.runFullIntegrityCheck(callbacks);

        expect(result.skipped).toBe(1);
        expect(callbacks.onLog).toHaveBeenCalledWith(
            expect.stringContaining('Failed to verify'),
            'error',
        );
    });

    it('fires onFileProgress twice per file (before and after verification)', async () => {
        vi.mocked(verificationService.verifyFile).mockResolvedValue({ status: 'passed' } as any);

        const callbacks = makeCallbacks();
        await service.runFullIntegrityCheck(callbacks);

        // Called once before (index=0) and once after (index=1) for the single file.
        expect(callbacks.onFileProgress).toHaveBeenCalledTimes(2);
        expect(callbacks.onFileProgress).toHaveBeenNthCalledWith(1, 0, 1, 'backup.sql');
        expect(callbacks.onFileProgress).toHaveBeenNthCalledWith(2, 1, 1, 'backup.sql');
    });
});
