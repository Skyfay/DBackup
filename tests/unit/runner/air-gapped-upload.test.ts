import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { stepUpload } from '@/lib/runner/steps/03-upload';
import { reportSkippedAirGaps, SKIP_STATE_KEY } from '@/lib/runner/steps/air-gap';
import { AIR_GAP_SKIP } from '@/lib/core/air-gap';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/types';
import type { RunnerContext, DestinationContext } from '@/lib/runner/types';

const { prismaMock, checkMock, notifyMock } = vi.hoisted(() => ({
    prismaMock: {
        execution: { update: vi.fn() },
        systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
        healthCheckLog: { findFirst: vi.fn() },
    },
    checkMock: vi.fn(),
    notifyMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/transport/adapter-invoke', () => ({ runConnectivityCheck: checkMock }));
vi.mock('@/services/notifications/system-notification-service', () => ({ notify: notifyMock }));
vi.mock('@/lib/crypto', () => ({ decryptConfig: vi.fn((c) => c) }));
vi.mock('@/lib/crypto/stream', () => ({ createEncryptionStream: vi.fn() }));
vi.mock('@/services/backup/encryption-service', () => ({ getProfileMasterKey: vi.fn() }));
vi.mock('@/lib/crypto/checksum', () => ({
    calculateFileChecksum: vi.fn().mockResolvedValue('abc123'),
    calculateFileChecksums: vi.fn().mockResolvedValue({ sha256: 'abc123', md5: 'def456' }),
    verifyFileChecksum: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/services/storage/verification-service', () => ({
    verificationService: { verifyFile: vi.fn().mockResolvedValue({ status: 'passed', verifiedAt: new Date().toISOString() }) },
}));
vi.mock('@/services/storage/storage-service', () => ({
    storageService: { appendStorageListCacheEntry: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/temp-dir', () => ({ getTempDir: vi.fn().mockReturnValue('/tmp') }));

/** The stored state of the skip event, as the run reads it. */
let skipState: Record<string, string> | null = null;

function destination(overrides: Partial<DestinationContext> = {}): DestinationContext {
    return {
        configId: 'nas',
        configName: 'NAS',
        adapter: { type: 'storage', upload: vi.fn().mockResolvedValue(true), ping: vi.fn() } as any,
        config: { path: '/backups' },
        retention: { mode: 'NONE' },
        priority: 0,
        adapterId: 'local-filesystem',
        ...overrides,
    };
}

function usb(overrides: Partial<DestinationContext> = {}): DestinationContext {
    return destination({ configId: 'usb', configName: 'USB rotation', priority: 1, airGapped: true, ...overrides });
}

describe('an air-gapped destination in a run', () => {
    let ctx: RunnerContext;

    beforeEach(() => {
        vi.clearAllMocks();
        skipState = null;
        prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
            where.key === SKIP_STATE_KEY && skipState ? { value: JSON.stringify(skipState) } : null);
        prismaMock.systemSetting.upsert.mockImplementation(async ({ update }: { update: { value: string } }) => {
            skipState = JSON.parse(update.value);
        });
        prismaMock.healthCheckLog.findFirst.mockResolvedValue(null);
        notifyMock.mockResolvedValue({ succeeded: 1, failed: 0 });

        const tempFile = path.join(os.tmpdir(), `air-gap-${Date.now()}-${Math.random()}.sql`);
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
            job: { id: 'job-1', name: 'Shop', source: { id: 's1', name: 'DB', adapterId: 'mysql' }, destinations: [], notifications: [], compression: 'NONE', encryptionProfileId: null } as any,
        } as unknown as RunnerContext;
    });

    it('leaves it out while it is not connected, and the run stays a success', async () => {
        checkMock.mockResolvedValue({ success: false, message: 'No such directory' });
        const away = usb();
        ctx.destinations = [destination(), away];
        const setUploads = vi.fn();
        ctx.setUploads = setUploads;

        await stepUpload(ctx);

        expect(away.adapter.upload).not.toHaveBeenCalled();
        expect(away.uploadResult).toEqual({ success: false, skipped: true, error: AIR_GAP_SKIP });
        expect(ctx.destinations[0].uploadResult?.success).toBe(true);
        expect(ctx.status).toBe('Running');
        expect(setUploads.mock.calls.at(-1)![0].map((upload: { state: string }) => upload.state)).toEqual(['done', 'skipped']);
    });

    it('asks only the air-gapped destination whether it answers, and uploads to it once it does', async () => {
        checkMock.mockResolvedValue({ success: true, message: 'ok' });
        const plugged = usb();
        ctx.destinations = [destination(), plugged];

        await stepUpload(ctx);

        expect(checkMock).toHaveBeenCalledTimes(1);
        expect(plugged.adapter.upload).toHaveBeenCalled();
        expect(plugged.uploadResult?.success).toBe(true);
        expect(notifyMock).not.toHaveBeenCalled();
    });

    it('counts a question that throws as not connected', async () => {
        checkMock.mockRejectedValue(new Error('Timed out after 15000ms'));
        const away = usb();
        ctx.destinations = [destination(), away];

        await stepUpload(ctx);

        expect(away.uploadResult?.skipped).toBe(true);
    });

    it('is still Partial when a connected destination fails beside the one that is away', async () => {
        checkMock.mockResolvedValue({ success: false, message: 'unplugged' });
        ctx.destinations = [
            destination(),
            destination({ configId: 's3', configName: 'S3', priority: 2, adapter: { upload: vi.fn().mockRejectedValue(new Error('S3 timeout')) } as any }),
            usb(),
        ];

        await stepUpload(ctx);

        expect(ctx.status).toBe('Partial');
    });

    it('fails the run when no destination took the backup', async () => {
        checkMock.mockResolvedValue({ success: false, message: 'unplugged' });
        ctx.destinations = [usb({ priority: 0 })];

        await expect(stepUpload(ctx)).rejects.toThrow('every one is air-gapped and not connected');
    });

    it('names the failed and the away ones when neither took the backup', async () => {
        checkMock.mockResolvedValue({ success: false, message: 'unplugged' });
        ctx.destinations = [destination({ adapter: { upload: vi.fn().mockRejectedValue(new Error('S3 timeout')) } as any }), usb()];

        await expect(stepUpload(ctx)).rejects.toThrow('1 failed and 1 air-gapped not connected');
    });

    it('reports the skip once with the job and when it was last connected', async () => {
        checkMock.mockResolvedValue({ success: false, message: 'unplugged' });
        prismaMock.healthCheckLog.findFirst.mockResolvedValue({ createdAt: new Date('2026-09-28T08:00:00Z') });
        ctx.destinations = [destination(), usb()];

        await stepUpload(ctx);

        expect(notifyMock).toHaveBeenCalledTimes(1);
        expect(notifyMock).toHaveBeenCalledWith(
            {
                eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED,
                data: expect.objectContaining({ storageName: 'USB rotation', jobName: 'Shop', lastConnectedAt: '2026-09-28T08:00:00.000Z' }),
            },
            { executionId: 'exec-1' },
        );
        expect(Object.keys(skipState ?? {})).toEqual(['usb']);
    });
});

describe('the report of a skipped air-gapped destination', () => {
    const ctx = { job: { name: 'Shop' }, execution: { id: 'exec-2' } } as unknown as RunnerContext;
    const away = usb();

    beforeEach(() => {
        vi.clearAllMocks();
        skipState = null;
        prismaMock.systemSetting.findUnique.mockImplementation(async () => (skipState ? { value: JSON.stringify(skipState) } : null));
        prismaMock.systemSetting.upsert.mockImplementation(async ({ update }: { update: { value: string } }) => {
            skipState = JSON.parse(update.value);
        });
        notifyMock.mockResolvedValue({ succeeded: 1, failed: 0 });
    });

    it('stays quiet for the runs after the first while it was not connected since', async () => {
        prismaMock.healthCheckLog.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 86_400_000) });

        await reportSkippedAirGaps(ctx, [away]);
        await reportSkippedAirGaps(ctx, [away]);

        expect(notifyMock).toHaveBeenCalledTimes(1);
    });

    it('reports again once it was connected after the last report', async () => {
        skipState = { usb: new Date(Date.now() - 7 * 86_400_000).toISOString() };
        prismaMock.healthCheckLog.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 86_400_000) });

        await reportSkippedAirGaps(ctx, [away]);

        expect(notifyMock).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when it never answered a check since the report', async () => {
        skipState = { usb: new Date(Date.now() - 86_400_000).toISOString() };
        prismaMock.healthCheckLog.findFirst.mockResolvedValue(null);

        await reportSkippedAirGaps(ctx, [away]);

        expect(notifyMock).not.toHaveBeenCalled();
    });

    it('records nothing while the event is off, so switching it on reports the next skip', async () => {
        prismaMock.healthCheckLog.findFirst.mockResolvedValue(null);
        notifyMock.mockResolvedValue(undefined);

        await reportSkippedAirGaps(ctx, [away]);

        expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('never fails the run when the report fails', async () => {
        prismaMock.systemSetting.findUnique.mockRejectedValue(new Error('database is locked'));

        await expect(reportSkippedAirGaps(ctx, [away])).resolves.toBeUndefined();
    });
});
