import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackupMetadata } from '@/lib/core/interfaces';

vi.mock('@/lib/prisma', () => ({
    default: {
        adapterConfig: { findUnique: vi.fn() },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ resolved: true }),
}));

vi.mock('@/lib/crypto/checksum', () => ({
    calculateFileChecksum: vi.fn(),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('fs/promises', () => {
    const readFile = vi.fn().mockResolvedValue('{}');
    const unlink = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    return {
        default: { readFile, unlink, writeFile },
        readFile,
        unlink,
        writeFile,
    };
});

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

vi.mock('@/services/storage/storage-service', () => ({
    storageService: {
        updateStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
    },
}));

import prisma from '@/lib/prisma';
import { registry } from '@/lib/core/registry';
import { calculateFileChecksum } from '@/lib/crypto/checksum';
import { verificationService } from '@/services/storage/verification-service';
import fsPromises from 'fs/promises';

function makeAdapterConfig(overrides: Record<string, unknown> = {}) {
    return {
        id: 'config-1',
        adapterId: 'local',
        name: 'Local Storage',
        config: '{}',
        primaryCredentialId: null,
        sshCredentialId: null,
        metadata: null,
        ...overrides,
    };
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
    return {
        download: vi.fn().mockResolvedValue(false),
        upload: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeMetadata(overrides: Partial<BackupMetadata> = {}): BackupMetadata {
    return {
        version: 1,
        jobId: 'job-1',
        jobName: 'Test Job',
        sourceName: 'Test Source',
        sourceType: 'mysql',
        databases: ['testdb'],
        timestamp: '2024-01-01T00:00:00.000Z',
        originalFileName: 'backup.sql',
        sourceId: 'src-1',
        checksum: 'sha256:abc123',
        ...overrides,
    };
}

describe('VerificationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(calculateFileChecksum).mockResolvedValue('sha256:abc123');
    });

    it('throws when adapter config is not found', async () => {
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await expect(
            verificationService.verifyFile('missing-id', 'backup.sql', 'manual')
        ).rejects.toThrow('Storage configuration not found');
    });

    it('throws when adapter is not in registry', async () => {
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

        await expect(
            verificationService.verifyFile('config-1', 'backup.sql', 'manual')
        ).rejects.toThrow("Adapter 'local' not found");
    });

    it('returns no_metadata when adapter.read returns null and download returns false', async () => {
        const adapter = makeAdapter({ read: vi.fn().mockResolvedValue(null) });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('no_metadata');
    });

    it('returns no_metadata when adapter has no read method and download returns false', async () => {
        const adapter = makeAdapter({ read: undefined });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('no_metadata');
        expect(adapter.download).toHaveBeenCalledWith(
            expect.anything(),
            'backup.sql.meta.json',
            expect.stringContaining('/tmp')
        );
    });

    it('returns no_checksum when metadata has no checksum fields', async () => {
        const metadata = makeMetadata({ checksum: undefined, checksumMd5: undefined });
        const adapter = makeAdapter({ read: vi.fn().mockResolvedValue(JSON.stringify(metadata)) });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('no_checksum');
    });

    it('returns skipped when skipIfPassed is true and metadata.verification.passed is true', async () => {
        const metadata = makeMetadata({
            verification: { verifiedAt: '2024-01-01T00:00:00.000Z', passed: true, trigger: 'manual' },
        });
        const adapter = makeAdapter({ read: vi.fn().mockResolvedValue(JSON.stringify(metadata)) });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual', { skipIfPassed: true });

        expect(result.status).toBe('skipped');
    });

    it('does not skip when skipIfPassed is true but verification has not passed', async () => {
        const metadata = makeMetadata({
            verification: { verifiedAt: '2024-01-01T00:00:00.000Z', passed: false, trigger: 'manual' },
        });
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual', { skipIfPassed: true });

        expect(result.status).not.toBe('skipped');
    });

    it('returns passed via native verifyChecksum', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            verifyChecksum: vi.fn().mockResolvedValue('passed'),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('passed');
        expect(adapter.verifyChecksum).toHaveBeenCalledWith(
            expect.anything(),
            'backup.sql',
            expect.objectContaining({ sha256: 'sha256:abc123' })
        );
    });

    it('returns failed via native verifyChecksum', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            verifyChecksum: vi.fn().mockResolvedValue('failed'),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('failed');
    });

    it('falls back to download when native verifyChecksum returns unsupported', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            verifyChecksum: vi.fn().mockResolvedValue('unsupported'),
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(calculateFileChecksum).mockResolvedValue('sha256:abc123');

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('passed');
        expect(adapter.download).toHaveBeenCalledWith(
            expect.anything(),
            'backup.sql',
            expect.stringContaining('/tmp')
        );
    });

    it('returns passed when download checksum matches', async () => {
        const metadata = makeMetadata({ checksum: 'sha256:expected' });
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(calculateFileChecksum).mockResolvedValue('sha256:expected');

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('passed');
        expect(result.expectedChecksum).toBe('sha256:expected');
        expect(result.actualChecksum).toBeUndefined();
    });

    it('returns failed when download checksum does not match', async () => {
        const metadata = makeMetadata({ checksum: 'sha256:expected' });
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(calculateFileChecksum).mockResolvedValue('sha256:tampered');

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('failed');
        expect(result.expectedChecksum).toBe('sha256:expected');
        expect(result.actualChecksum).toBe('sha256:tampered');
    });

    it('returns download_error when adapter.download returns false for the backup file', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockResolvedValue(false),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('download_error');
    });

    it('returns download_error when adapter.download throws', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockRejectedValue(new Error('Network timeout')),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.status).toBe('download_error');
    });

    it('reads metadata via adapter.download when adapter has no read method', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: undefined,
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(metadata));

        await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(adapter.download).toHaveBeenCalledWith(
            expect.anything(),
            'backup.sql.meta.json',
            expect.stringContaining('/tmp')
        );
    });

    it('calls adapter.upload to persist verification result after native check', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            verifyChecksum: vi.fn().mockResolvedValue('passed'),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

        await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(adapter.upload).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('/tmp'),
            'backup.sql.meta.json'
        );
    });

    it('calls adapter.upload to persist verification result after download-based check', async () => {
        const metadata = makeMetadata();
        const adapter = makeAdapter({
            read: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
            download: vi.fn().mockResolvedValue(true),
        });
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
        vi.mocked(calculateFileChecksum).mockResolvedValue('sha256:abc123');

        await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(adapter.upload).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('/tmp'),
            'backup.sql.meta.json'
        );
    });

    it('includes verifiedAt in every result', async () => {
        (prisma.adapterConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdapterConfig());
        (registry.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAdapter({ read: vi.fn().mockResolvedValue(null) }));

        const result = await verificationService.verifyFile('config-1', 'backup.sql', 'manual');

        expect(result.verifiedAt).toBeDefined();
        expect(new Date(result.verifiedAt).getTime()).not.toBeNaN();
    });
});
