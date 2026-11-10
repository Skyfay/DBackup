import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { resolveDecryptionKey } from '@/services/restore/smart-recovery';
import * as encryptionService from '@/services/backup/encryption-service';
import { PassThrough } from 'stream';

// Hoisted so the same vi.fn() instance is used in both the mock factory and test assertions.
const mockCreateReadStream = vi.hoisted(() => vi.fn());

// --- Mocks ---

vi.mock('@/services/backup/encryption-service', () => ({
    getProfileMasterKey: vi.fn(),
    getEncryptionProfiles: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        default: { ...actual, createReadStream: mockCreateReadStream },
        createReadStream: mockCreateReadStream,
    };
});

// --- Helpers ---

/**
 * Encrypts plaintext with AES-256-GCM using a fixed IV for deterministic tests.
 */
function encryptBuffer(
    key: Buffer,
    plaintext: Buffer,
    iv = Buffer.alloc(16, 0x01),
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Returns a PassThrough stream that emits the given data and then ends.
 */
function makeReadStream(data: Buffer): PassThrough {
    const stream = new PassThrough();
    stream.push(data);
    stream.push(null);
    return stream;
}

function makeEncryptionMeta(iv: Buffer, authTag: Buffer, overrides: Record<string, unknown> = {}) {
    return {
        enabled: true as const,
        algorithm: 'aes-256-gcm' as const,
        profileId: 'profile-abc',
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ...overrides,
    };
}

// Fixed keys, since with random ones a wrong key decrypts to the GZIP magic about once in
// 65536 runs, which the heuristic takes as a fit.
const correctKey = Buffer.alloc(32, 0xc1);
const wrongKey   = Buffer.alloc(32, 0x5e);
const noop = vi.fn();

describe('resolveDecryptionKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the key directly when the profile exists', async () => {
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>).mockResolvedValue(correctKey);

        const { iv, authTag } = encryptBuffer(correctKey, Buffer.from('SELECT 1'));
        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.sql',
            undefined,
            noop,
        );

        expect(result).toBe(correctKey);
        expect(encryptionService.getProfileMasterKey).toHaveBeenCalledWith('profile-abc');
        expect(encryptionService.getEncryptionProfiles).not.toHaveBeenCalled();
    });

    it('throws when profile is missing and no other profile matches', async () => {
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Profile not found'),
        );
        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const { iv, authTag } = encryptBuffer(correctKey, Buffer.from('SELECT 1'));
        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql', undefined, noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('logs a warning when attempting smart recovery', async () => {
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Profile not found'),
        );
        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const log = vi.fn();
        const { iv, authTag } = encryptBuffer(correctKey, Buffer.from('SELECT 1'));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql', undefined, log),
        ).rejects.toThrow();

        expect(log).toHaveBeenCalledWith(
            expect.stringContaining('Smart Recovery'),
            'warning',
        );
    });

    it('attempts all available profiles before throwing', async () => {
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Profile not found'),
        );
        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'profile-1', name: 'Profile 1' },
            { id: 'profile-2', name: 'Profile 2' },
            { id: 'profile-3', name: 'Profile 3' },
        ]);

        const { iv, authTag, ciphertext } = encryptBuffer(correctKey, Buffer.from('SELECT 1'));
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql', undefined, noop),
        ).rejects.toThrow();

        // Called once for original + once per candidate profile
        expect(encryptionService.getProfileMasterKey).toHaveBeenCalledTimes(4);
    });
});

// --- checkKeyCandidate coverage ---
// These tests drive checkKeyCandidate via resolveDecryptionKey's smart-recovery loop.
// The original profile fails, one candidate is provided, and we test with REAL AES-256-GCM
// encrypted data so the actual crypto.Decipher.update() path is exercised.

describe('checkKeyCandidate (via resolveDecryptionKey)', () => {
    const candidateProfile = { id: 'cand-1', name: 'Candidate' };
    const iv = Buffer.alloc(16, 0x01); // fixed IV for all tests in this block

    function setupSmartRecovery(candidateKey: Buffer) {
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new Error('Profile not found'))  // original profile
            .mockResolvedValueOnce(candidateKey);                   // candidate profile
        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>)
            .mockResolvedValue([candidateProfile]);
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns key when decrypted content starts with GZIP magic bytes (correct key)', async () => {
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(20)]);
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.sql.gz.enc',
            'GZIP',
            noop,
        );
        expect(result).toBe(correctKey);
    });

    it('takes no key for a file whose metadata names a tag shorter than 16 bytes', async () => {
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(20)]);
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag.subarray(0, 4)), '/tmp/backup.sql.gz.enc', 'GZIP', noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('throws when decrypted GZIP content has wrong magic bytes (wrong key)', async () => {
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(20)]);
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        // Provide the wrong key as candidate - decryption produces garbage, not GZIP magic
        setupSmartRecovery(wrongKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql.gz.enc', 'GZIP', noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('returns key when decrypted SQL content has high printable ASCII ratio (correct key)', async () => {
        const plaintext = Buffer.from('INSERT INTO users VALUES (1, "alice", "admin");\nSELECT * FROM users;\n');
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.sql.enc',
            undefined,
            noop,
        );
        expect(result).toBe(correctKey);
    });

    it('throws when decrypted content is mostly non-printable binary (wrong key)', async () => {
        const plaintext = Buffer.from('INSERT INTO users VALUES (1, "alice");\n');
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        // Provide the wrong key - decrypted output is binary garbage (low printable ratio)
        setupSmartRecovery(wrongKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql.enc', undefined, noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('returns key when decrypted content is a TAR archive (ustar magic at offset 257)', async () => {
        // TAR header: 512 bytes - filename at 0, "ustar" magic at offset 257, rest is null padding.
        const tarHeader = Buffer.alloc(512, 0x00);
        Buffer.from('manifest.json').copy(tarHeader, 0);
        Buffer.from('ustar').copy(tarHeader, 257); // POSIX TAR magic
        const plaintext = tarHeader;
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.tar.enc',
            undefined,
            noop,
        );
        expect(result).toBe(correctKey);
    });

    it('returns key when decrypted content is a PostgreSQL custom-format dump (PGDMP magic)', async () => {
        // pg_dump -Fc always starts with the 5-byte ASCII magic "PGDMP" followed by version bytes.
        // This applies to single-DB backups regardless of the -Z compression level.
        const pgHeader = Buffer.alloc(512, 0x00);
        Buffer.from('PGDMP').copy(pgHeader, 0);
        pgHeader[5] = 0x01; // version major
        pgHeader[6] = 0x0e; // version minor
        const { ciphertext, authTag } = encryptBuffer(correctKey, pgHeader, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.dump.enc',
            undefined,
            noop,
        );
        expect(result).toBe(correctKey);
    });

    it('throws when decrypted PostgreSQL dump has wrong PGDMP magic (wrong key)', async () => {
        const pgHeader = Buffer.alloc(512, 0x00);
        Buffer.from('PGDMP').copy(pgHeader, 0);
        const { ciphertext, authTag } = encryptBuffer(correctKey, pgHeader, iv);

        setupSmartRecovery(wrongKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.dump.enc', undefined, noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('returns key when decrypted content is a mongodump gzip archive (GZIP magic, no pipeline compression)', async () => {
        // mongodump --archive --gzip produces a gzip stream regardless of the pipeline
        // compression setting. compressionMeta is undefined in this scenario.
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(60)]);
        const { ciphertext, authTag } = encryptBuffer(correctKey, plaintext, iv);

        setupSmartRecovery(correctKey);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag),
            '/tmp/backup.archive.enc',
            undefined, // no pipeline compression - mongodump handles gzip internally
            noop,
        );
        expect(result).toBe(correctKey);
    });

    it('throws when createReadStream emits an error', async () => {
        const { authTag } = encryptBuffer(correctKey, Buffer.from('SELECT 1'), iv);

        setupSmartRecovery(correctKey);
        const errStream = new PassThrough();
        mockCreateReadStream.mockReturnValue(errStream);
        setTimeout(() => errStream.destroy(new Error('disk read error')), 5);

        await expect(
            resolveDecryptionKey(makeEncryptionMeta(iv, authTag), '/tmp/backup.sql.enc', undefined, noop),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });
});

// --- Key Import Scenario ---
// Simulates the real-world workflow that triggered the original bug:
//   1. User creates an encryption profile and runs a backup (SQL, GZIP, TAR).
//   2. The profile is deleted - its ID is gone from the DB.
//   3. The user imports the same raw key again - same bytes, but a NEW profile ID.
//   4. Smart Recovery must find the re-imported profile and decrypt the backup.

describe('Key Import Scenario (delete + re-import with new ID)', () => {
    const masterKey   = Buffer.alloc(32, 0xa7);
    const iv          = Buffer.alloc(16, 0x03);
    const originalId  = 'original-profile-id';
    const reimportedId = 're-imported-profile-id';
    const log = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Original profile is gone - getProfileMasterKey throws for it.
        // The re-imported profile uses the exact same key bytes.
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>)
            .mockImplementation((id: string) => {
                if (id === originalId) return Promise.reject(new Error('Profile not found'));
                if (id === reimportedId) return Promise.resolve(masterKey);
                return Promise.reject(new Error('Unknown profile'));
            });

        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>)
            .mockResolvedValue([{ id: reimportedId, name: 'My Key (re-imported)' }]);
    });

    it('recovers a plain SQL dump (.sql.enc)', async () => {
        const plaintext = Buffer.from('INSERT INTO users VALUES (1, "alice");\n'.repeat(5));
        const { ciphertext, authTag } = encryptBuffer(masterKey, plaintext, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.sql.enc',
            undefined,
            log,
        );
        expect(result).toBe(masterKey);
    });

    it('recovers a GZIP-compressed dump (.sql.gz.enc)', async () => {
        // Plaintext starting with GZIP magic bytes - as if a real .gz was encrypted.
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(60)]);
        const { ciphertext, authTag } = encryptBuffer(masterKey, plaintext, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.sql.gz.enc',
            'GZIP',
            log,
        );
        expect(result).toBe(masterKey);
    });

    it('recovers a multi-DB TAR archive (.tar.enc)', async () => {
        // TAR header: 512 bytes with "ustar" magic at offset 257 (POSIX TAR format).
        const tarHeader = Buffer.alloc(512, 0x00);
        Buffer.from('manifest.json').copy(tarHeader, 0);
        Buffer.from('ustar').copy(tarHeader, 257);
        const { ciphertext, authTag } = encryptBuffer(masterKey, tarHeader, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.tar.enc',
            undefined,
            log,
        );
        expect(result).toBe(masterKey);
    });

    it('fails when the re-imported key bytes differ from the original (wrong key imported)', async () => {
        const differentKey = Buffer.alloc(32, 0x3d);
        const plaintext    = Buffer.from('SELECT 1;\n'.repeat(10));
        // Backup was encrypted with masterKey, but user imported a different key.
        const { ciphertext, authTag } = encryptBuffer(masterKey, plaintext, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>)
            .mockImplementation((id: string) => {
                if (id === originalId)   return Promise.reject(new Error('Profile not found'));
                if (id === reimportedId) return Promise.resolve(differentKey);
                return Promise.reject(new Error('Unknown profile'));
            });

        await expect(
            resolveDecryptionKey(
                makeEncryptionMeta(iv, authTag, { profileId: originalId }),
                '/tmp/backup.sql.enc',
                undefined,
                log,
            ),
        ).rejects.toThrow('missing, and no other profile could decrypt this file');
    });

    it('tries all available profiles and returns the one with the matching key', async () => {
        const wrongKey1 = Buffer.alloc(32, 0x11);
        const wrongKey2 = Buffer.alloc(32, 0x22);
        const plaintext = Buffer.from('SELECT * FROM orders;\n'.repeat(5));
        const { ciphertext, authTag } = encryptBuffer(masterKey, plaintext, iv);
        // Each checkKeyCandidate call opens a new ReadStream - return a fresh stream per call.
        mockCreateReadStream.mockImplementation(() => makeReadStream(ciphertext));

        (encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                { id: 'wrong-1', name: 'Some other profile' },
                { id: 'wrong-2', name: 'Another profile' },
                { id: reimportedId, name: 'My Key (re-imported)' },
            ]);
        (encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>)
            .mockImplementation((id: string) => {
                if (id === originalId)   return Promise.reject(new Error('Profile not found'));
                if (id === 'wrong-1')    return Promise.resolve(wrongKey1);
                if (id === 'wrong-2')    return Promise.resolve(wrongKey2);
                if (id === reimportedId) return Promise.resolve(masterKey);
                return Promise.reject(new Error('Unknown profile'));
            });

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.sql.enc',
            undefined,
            log,
        );
        expect(result).toBe(masterKey);
        // Original + 3 candidates = 4 calls total.
        expect(encryptionService.getProfileMasterKey).toHaveBeenCalledTimes(4);
    });

    it('recovers a single-DB PostgreSQL dump (.dump.enc, no pipeline compression)', async () => {
        // pg_dump -Fc always starts with "PGDMP" regardless of the -Z compression setting.
        // Single-DB PG backups fail the ASCII heuristic because the custom format is binary.
        const pgHeader = Buffer.alloc(512, 0x00);
        Buffer.from('PGDMP').copy(pgHeader, 0);
        pgHeader[5] = 0x01; // version major
        pgHeader[6] = 0x0e; // version minor
        const { ciphertext, authTag } = encryptBuffer(masterKey, pgHeader, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.dump.enc',
            undefined, // no pipeline compression
            log,
        );
        expect(result).toBe(masterKey);
    });

    it('recovers a single-DB MongoDB archive (.archive.enc, no pipeline compression)', async () => {
        // mongodump --archive --gzip produces a gzip stream stored directly as the backup file.
        // compressionMeta is undefined because no pipeline compression is configured.
        const plaintext = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(60)]);
        const { ciphertext, authTag } = encryptBuffer(masterKey, plaintext, iv);
        mockCreateReadStream.mockReturnValue(makeReadStream(ciphertext));

        const result = await resolveDecryptionKey(
            makeEncryptionMeta(iv, authTag, { profileId: originalId }),
            '/tmp/backup.archive.enc',
            undefined, // mongodump handles gzip internally, no pipeline compression
            log,
        );
        expect(result).toBe(masterKey);
    });
});
