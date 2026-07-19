import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { StorageService } from '@/services/storage/storage-service';
import { registry } from '@/lib/core/registry';
import { StorageAdapter } from '@/lib/core/interfaces';

// ── Module Mocks ───────────────────────────────────────────────

vi.mock('@/lib/crypto', () => ({
    decryptConfig: (input: any) => input,
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

const mockResolveAdapterConfig = vi.fn();
vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

vi.mock('@/lib/temp-dir', () => ({
    getTempDir: () => '/tmp',
}));

vi.mock('fs', async () => {
    const createReadStream = vi.fn();
    const createWriteStream = vi.fn();
    const promises = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue('{}'),
    };
    return {
        createReadStream,
        createWriteStream,
        promises,
        default: { createReadStream, createWriteStream, promises },
    };
});

vi.mock('stream/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('stream/promises')>();
    return { ...actual, pipeline: vi.fn().mockResolvedValue(undefined) };
});

import { createReadStream as _mockCRS, createWriteStream as _mockCWS, promises as _mockFsP } from 'fs';
import { pipeline as _mockPipeline } from 'stream/promises';

const fsMocks = {
    get createReadStream() { return _mockCRS as unknown as ReturnType<typeof vi.fn>; },
    get createWriteStream() { return _mockCWS as unknown as ReturnType<typeof vi.fn>; },
    get writeFile() { return (_mockFsP as any).writeFile as ReturnType<typeof vi.fn>; },
    get unlink() { return (_mockFsP as any).unlink as ReturnType<typeof vi.fn>; },
    get rename() { return (_mockFsP as any).rename as ReturnType<typeof vi.fn>; },
    get readFile() { return (_mockFsP as any).readFile as ReturnType<typeof vi.fn>; },
};
const mockPipeline = _mockPipeline as unknown as ReturnType<typeof vi.fn>;

const mockGetProfileMasterKey = vi.fn().mockResolvedValue(Buffer.alloc(32));
vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: (...args: any[]) => mockGetProfileMasterKey(...args),
}));

const mockResolveDecryptionKey = vi.fn().mockResolvedValue(Buffer.alloc(32));
vi.mock('@/services/restore/smart-recovery', () => ({
    resolveDecryptionKey: (...args: any[]) => mockResolveDecryptionKey(...args),
}));

const mockCreateDecryptionStream = vi.fn().mockReturnValue(new PassThrough());
vi.mock('@/lib/crypto/stream', () => ({
    createDecryptionStream: (...args: any[]) => mockCreateDecryptionStream(...args),
}));

const mockAdmZipInstance = {
    addLocalFile: vi.fn(),
    writeZip: vi.fn(),
};
vi.mock('adm-zip', () => ({
    default: function () { return mockAdmZipInstance; },
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: {
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));
vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e: any) => e),
}));

// ── Helpers ────────────────────────────────────────────────────

function makeDbConfig(overrides?: Record<string, any>) {
    return {
        id: 'conf-123',
        name: 'Test Storage',
        type: 'storage',
        adapterId: 'local-filesystem',
        config: JSON.stringify({ basePath: '/tmp/backups' }),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: null,
        lastHealthCheck: null,
        lastStatus: 'ONLINE',
        consecutiveFailures: 0,
        lastError: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        defaultRetentionPolicyId: null,
        usableAsSource: false,
        usableAsDestination: true,
        ...overrides,
    };
}

function makeAdapter(overrides?: Record<string, any>): StorageAdapter {
    return {
        id: 'local-filesystem',
        type: 'storage',
        name: 'Local',
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
        download: vi.fn().mockResolvedValue(true),
        upload: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(null),
        ...overrides,
    } as unknown as StorageAdapter;
}

// ── Tests ──────────────────────────────────────────────────────

describe('StorageService.downloadFile - encryption and .enc paths', () => {
    let service: StorageService;

    beforeEach(() => {
        service = new StorageService();
        vi.clearAllMocks();
        mockResolveAdapterConfig.mockImplementation((adapterConfig: any) =>
            Promise.resolve(JSON.parse(adapterConfig.config))
        );
        fsMocks.writeFile.mockResolvedValue(undefined);
        fsMocks.unlink.mockResolvedValue(undefined);
        fsMocks.rename.mockResolvedValue(undefined);
        fsMocks.readFile.mockResolvedValue('{}');
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });
        fsMocks.createWriteStream.mockImplementation(() => new PassThrough());
        mockPipeline.mockResolvedValue(undefined);
        mockGetProfileMasterKey.mockResolvedValue(Buffer.alloc(32));
        mockResolveDecryptionKey.mockResolvedValue(Buffer.alloc(32));
        mockCreateDecryptionStream.mockReturnValue(new PassThrough());
        mockAdmZipInstance.addLocalFile.mockReset();
        mockAdmZipInstance.writeZip.mockReset();
    });

    // ===== decrypt=true with encryption metadata =====

    describe('decrypt=true - encryption metadata present', () => {
        it('decrypts the file using meta.encryption object style', async () => {
            const meta = JSON.stringify({
                encryption: {
                    enabled: true,
                    profileId: 'profile-abc',
                    algorithm: 'aes-256-gcm',
                    iv: 'aa'.repeat(12),
                    authTag: 'bb'.repeat(8),
                },
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true);

            expect(result.success).toBe(true);
            // resolveDecryptionKey was called to find the key for the profile
            expect(mockResolveDecryptionKey).toHaveBeenCalled();
        });

        it('decrypts the file using legacy meta format (encryptionProfileId/iv/authTag)', async () => {
            const meta = JSON.stringify({
                encryptionProfileId: 'profile-xyz',
                iv: 'cc'.repeat(12),
                authTag: 'dd'.repeat(8),
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true);

            expect(result.success).toBe(true);
            expect(mockCreateDecryptionStream).toHaveBeenCalled();
        });

        it('uses rawKeyHex option instead of resolving the profile', async () => {
            const rawKeyHex = 'aa'.repeat(32);
            const meta = JSON.stringify({
                encryption: {
                    enabled: true,
                    profileId: 'profile-abc',
                    algorithm: 'aes-256-gcm',
                    iv: 'aa'.repeat(12),
                    authTag: 'bb'.repeat(8),
                },
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

            expect(result.success).toBe(true);
            expect(mockGetProfileMasterKey).not.toHaveBeenCalled();
            expect(mockResolveDecryptionKey).not.toHaveBeenCalled();
        });

        it('uses profileIdOverride when provided', async () => {
            const meta = JSON.stringify({
                encryption: {
                    enabled: true,
                    profileId: 'profile-abc',
                    algorithm: 'aes-256-gcm',
                    iv: 'aa'.repeat(12),
                    authTag: 'bb'.repeat(8),
                },
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { profileIdOverride: 'override-profile' });

            expect(result.success).toBe(true);
            expect(mockGetProfileMasterKey).toHaveBeenCalledWith('override-profile');
        });

        it('throws ENCRYPTION_KEY_REQUIRED when resolveDecryptionKey fails', async () => {
            mockResolveDecryptionKey.mockRejectedValueOnce(new Error("No matching key"));

            const meta = JSON.stringify({
                encryption: {
                    enabled: true,
                    profileId: 'profile-abc',
                    algorithm: 'aes-256-gcm',
                    iv: 'aa'.repeat(12),
                    authTag: 'bb'.repeat(8),
                },
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            await expect(
                service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true)
            ).rejects.toThrow('ENCRYPTION_KEY_REQUIRED:profile-abc');
        });

        it('throws "Decryption failed" when createDecryptionStream throws', async () => {
            mockCreateDecryptionStream.mockImplementationOnce(() => {
                throw new Error("AES bad auth tag");
            });

            const meta = JSON.stringify({
                encryption: {
                    enabled: true,
                    profileId: 'profile-abc',
                    algorithm: 'aes-256-gcm',
                    iv: 'aa'.repeat(12),
                    authTag: 'bb'.repeat(8),
                },
            });

            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(meta),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            await expect(
                service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true)
            ).rejects.toThrow('Decryption failed: AES bad auth tag');
        });

        it('returns { success: false } when initial download fails', async () => {
            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(false),
                read: vi.fn().mockResolvedValue(null),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true);

            expect(result.success).toBe(false);
        });

        it('returns success without decryption when meta has no encryption params', async () => {
            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(JSON.stringify({ compression: 'GZIP' })),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true);

            expect(result.success).toBe(true);
            expect(mockCreateDecryptionStream).not.toHaveBeenCalled();
        });
    });

    // ===== .enc fallback path (decrypt=false, remotePath ends with .enc) =====

    describe('.enc fallback path', () => {
        it('downloads .enc file and meta, creates zip, returns isZip=true', async () => {
            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql.enc', '/tmp/out.enc', false);

            expect(result.success).toBe(true);
            expect(result.isZip).toBe(true);
            expect(mockAdmZipInstance.addLocalFile).toHaveBeenCalledTimes(2);
            expect(mockAdmZipInstance.writeZip).toHaveBeenCalledWith('/tmp/out.enc');
        });

        it('returns isZip=false and renames when meta download fails', async () => {
            const adapter = makeAdapter({
                download: vi.fn()
                    .mockResolvedValueOnce(true)   // main .enc file
                    .mockResolvedValueOnce(false),  // .meta.json not found
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql.enc', '/tmp/out.enc', false);

            expect(result.success).toBe(true);
            expect(result.isZip).toBe(false);
            expect(fsMocks.rename).toHaveBeenCalled();
        });

        it('falls back to rename when zip creation fails', async () => {
            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(true),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);
            mockAdmZipInstance.writeZip.mockImplementation(() => {
                throw new Error("Zip error");
            });

            const result = await service.downloadFile('conf-123', 'backup.sql.enc', '/tmp/out.enc', false);

            expect(result.success).toBe(true);
            expect(result.isZip).toBe(false);
            expect(fsMocks.rename).toHaveBeenCalled();
        });

        it('returns { success: false } when main .enc download fails', async () => {
            const adapter = makeAdapter({
                download: vi.fn().mockResolvedValue(false),
            });

            prismaMock.adapterConfig.findUnique.mockResolvedValue(makeDbConfig());
            vi.mocked(registry.get).mockReturnValue(adapter);

            const result = await service.downloadFile('conf-123', 'backup.sql.enc', '/tmp/out.enc', false);

            expect(result.success).toBe(false);
        });
    });
});
