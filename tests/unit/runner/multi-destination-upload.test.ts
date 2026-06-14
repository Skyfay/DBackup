import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepUpload } from '@/lib/runner/steps/03-upload';
import { RunnerContext, DestinationContext } from '@/lib/runner/types';

// Mock all external dependencies
vi.mock('@/lib/prisma', () => ({
    default: {
        execution: { update: vi.fn() },
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    }
}));
vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((c) => c),
}));
vi.mock('@/lib/crypto/stream', () => ({
    createEncryptionStream: vi.fn(),
}));
vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: vi.fn(),
}));
vi.mock('@/lib/crypto/checksum', () => ({
    calculateFileChecksum: vi.fn().mockResolvedValue('abc123'),
    calculateFileChecksums: vi.fn().mockResolvedValue({ sha256: 'abc123', md5: 'def456' }),
    verifyFileChecksum: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/services/storage/verification-service', () => ({
    verificationService: {
        verifyFile: vi.fn().mockResolvedValue({ status: 'passed', verifiedAt: new Date().toISOString() }),
    },
}));
vi.mock('@/services/storage/storage-service', () => ({
    storageService: {
        appendStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('@/lib/temp-dir', () => ({
    getTempDir: vi.fn().mockReturnValue('/tmp'),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Step 03 - Multi-Destination Upload', () => {
    let ctx: RunnerContext;
    let tempFile: string;

    const mockUpload = vi.fn().mockResolvedValue(true);
    const mockUploadFailing = vi.fn().mockRejectedValue(new Error('S3 timeout'));

    function createDestination(overrides: Partial<DestinationContext> = {}): DestinationContext {
        return {
            configId: 'dest-1',
            configName: 'Test Dest',
            adapter: {
                type: 'storage',
                upload: mockUpload,
                download: vi.fn(),
                list: vi.fn(),
                delete: vi.fn(),
            } as any,
            config: { path: '/backups' },
            retention: { mode: 'NONE' },
            priority: 0,
            adapterId: 'local-filesystem',
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();

        // Create a real temp file for the upload step
        tempFile = path.join(os.tmpdir(), `test-backup-${Date.now()}.sql`);
        fs.writeFileSync(tempFile, 'BACKUP CONTENT');

        ctx = {
            jobId: 'job-1',
            status: 'Running',
            startedAt: new Date(),
            logs: [],
            log: vi.fn(),
            updateProgress: vi.fn(),
            setStage: vi.fn(),
            updateDetail: vi.fn(),
            updateStageProgress: vi.fn(),
            execution: { id: 'exec-1' } as any,
            tempFile,
            destinations: [],
            job: {
                id: 'job-1',
                name: 'Test Job',
                source: { id: 's1', name: 'DB', adapterId: 'mysql' },
                destinations: [],
                notifications: [],
                compression: 'NONE',
                encryptionProfileId: null,
            } as any,
        } as unknown as RunnerContext;
    });

    it('should upload to single destination successfully', async () => {
        ctx.destinations = [createDestination({ configId: 'd1', configName: 'Local NAS' })];

        await stepUpload(ctx);

        expect(mockUpload).toHaveBeenCalled();
        expect(ctx.destinations[0].uploadResult).toEqual(
            expect.objectContaining({ success: true })
        );
    });

    it('should upload to multiple destinations sequentially', async () => {
        const upload1 = vi.fn().mockResolvedValue(true);
        const upload2 = vi.fn().mockResolvedValue(true);

        ctx.destinations = [
            createDestination({ configId: 'd1', configName: 'Local', adapter: { upload: upload1 } as any }),
            createDestination({ configId: 'd2', configName: 'S3', priority: 1, adapter: { upload: upload2 } as any }),
        ];

        await stepUpload(ctx);

        expect(upload1).toHaveBeenCalled();
        expect(upload2).toHaveBeenCalled();
        expect(ctx.destinations[0].uploadResult?.success).toBe(true);
        expect(ctx.destinations[1].uploadResult?.success).toBe(true);
    });

    it('should set Partial status when some destinations fail', async () => {
        ctx.destinations = [
            createDestination({ configId: 'd1', configName: 'Local' }),
            createDestination({
                configId: 'd2',
                configName: 'S3 Failing',
                priority: 1,
                adapter: { upload: mockUploadFailing } as any,
            }),
        ];

        await stepUpload(ctx);

        expect(ctx.destinations[0].uploadResult?.success).toBe(true);
        expect(ctx.destinations[1].uploadResult?.success).toBe(false);
        expect(ctx.status).toBe('Partial');
    });

    it('should throw when all destinations fail', async () => {
        ctx.destinations = [
            createDestination({
                configId: 'd1',
                configName: 'Dest1',
                adapter: { upload: mockUploadFailing } as any,
            }),
        ];

        await expect(stepUpload(ctx)).rejects.toThrow('failed');
    });

    it('should record individual upload results per destination', async () => {
        ctx.destinations = [
            createDestination({ configId: 'd1', configName: 'Local' }),
            createDestination({
                configId: 'd2',
                configName: 'Cloud',
                priority: 1,
                adapter: { upload: mockUploadFailing } as any,
            }),
            createDestination({ configId: 'd3', configName: 'NAS', priority: 2 }),
        ];

        await stepUpload(ctx);

        expect(ctx.destinations[0].uploadResult?.success).toBe(true);
        expect(ctx.destinations[1].uploadResult?.success).toBe(false);
        expect(ctx.destinations[1].uploadResult?.error).toBeDefined();
        expect(ctx.destinations[2].uploadResult?.success).toBe(true);
    });

    it('should set finalRemotePath from first successful upload', async () => {
        ctx.destinations = [
            createDestination({
                configId: 'd1',
                configName: 'Failing',
                adapter: { upload: mockUploadFailing } as any,
            }),
            createDestination({ configId: 'd2', configName: 'Succeeding', priority: 1 }),
        ];

        await stepUpload(ctx);

        expect(ctx.finalRemotePath).toBeDefined();
        expect(ctx.finalRemotePath).toContain('Test Job');
    });
});
