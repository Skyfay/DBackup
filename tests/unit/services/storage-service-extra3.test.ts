/**
 * Extra coverage for storage-service.ts targeting:
 *   - Lines 597-600: the rawKeyHex option path in downloadFile.
 *     Verifies that when the caller provides a raw hex key directly,
 *     no profile lookup occurs and the key is used as-is for decryption.
 */

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

describe('StorageService.downloadFile - rawKeyHex option (extra coverage)', () => {
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
        fsMocks.createReadStream.mockImplementation(() => {
            const pt = new PassThrough();
            setImmediate(() => pt.push(null));
            return pt;
        });
        fsMocks.createWriteStream.mockImplementation(() => new PassThrough());
        mockPipeline.mockResolvedValue(undefined);
        mockGetProfileMasterKey.mockResolvedValue(Buffer.alloc(32));
        mockCreateDecryptionStream.mockReturnValue(new PassThrough());
    });

    // -------------------------------------------------------------------------
    // rawKeyHex: key is parsed directly from hex without any profile lookup
    // -------------------------------------------------------------------------

    it('decodes rawKeyHex into a Buffer and passes it to createDecryptionStream', async () => {
        const rawKeyHex = 'ff'.repeat(32); // 32-byte key as hex (64 chars)
        const expectedKey = Buffer.from(rawKeyHex, 'hex');

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

        await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

        expect(mockCreateDecryptionStream).toHaveBeenCalled();
        const [keyArg] = mockCreateDecryptionStream.mock.calls[0];
        // The key passed must equal the hex-decoded rawKeyHex.
        expect(Buffer.isBuffer(keyArg)).toBe(true);
        expect(keyArg).toEqual(expectedKey);
    });

    it('does not call getProfileMasterKey when rawKeyHex is provided', async () => {
        const rawKeyHex = 'cc'.repeat(32);

        const meta = JSON.stringify({
            encryption: {
                enabled: true,
                profileId: 'profile-xyz',
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

        await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

        expect(mockGetProfileMasterKey).not.toHaveBeenCalled();
    });

    it('does not call resolveDecryptionKey when rawKeyHex is provided', async () => {
        const rawKeyHex = 'dd'.repeat(32);

        const meta = JSON.stringify({
            encryption: {
                enabled: true,
                profileId: 'profile-xyz',
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

        await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

        expect(mockResolveDecryptionKey).not.toHaveBeenCalled();
    });

    it('returns success when rawKeyHex is provided alongside legacy meta format', async () => {
        const rawKeyHex = 'ee'.repeat(32);

        // Legacy meta format uses encryptionProfileId at the top level rather than
        // the nested encryption object.
        const meta = JSON.stringify({
            encryptionProfileId: 'profile-legacy',
            iv: '11'.repeat(12),
            authTag: '22'.repeat(8),
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
        expect(mockCreateDecryptionStream).toHaveBeenCalled();
    });

    it('uses rawKeyHex key bytes, not a zero-filled fallback buffer', async () => {
        // All-zeros key is the mock default - rawKeyHex should produce a different key.
        const rawKeyHex = '01'.repeat(32);
        const expectedKey = Buffer.from(rawKeyHex, 'hex');

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

        await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

        const [keyArg] = mockCreateDecryptionStream.mock.calls[0];
        // Key must match the explicit rawKeyHex value - not the zero buffer default.
        expect(keyArg.equals(Buffer.alloc(32, 0))).toBe(false);
        expect(keyArg.equals(expectedKey)).toBe(true);
    });

    it('still invokes createDecryptionStream when rawKeyHex is provided', async () => {
        const rawKeyHex = 'ab'.repeat(32);

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

        await service.downloadFile('conf-123', 'backup.sql', '/tmp/out.sql', true, { rawKeyHex });

        // createDecryptionStream must have been called - decryption runs as normal.
        expect(mockCreateDecryptionStream).toHaveBeenCalled();
    });
});
