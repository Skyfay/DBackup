import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

// --- Module mocks ---

vi.mock('@/lib/crypto', () => ({
    encrypt: vi.fn((v: string) => `enc:${v}`),
    decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}));

import {
    getEncryptionProfiles,
    getEncryptionProfile,
    deleteEncryptionProfile,
    getProfileMasterKey,
    createEncryptionProfile,
    importEncryptionProfile,
} from '@/services/backup/encryption-service';
import { decrypt } from '@/lib/crypto';

// --- Test fixtures ---

const validHex64 = 'a'.repeat(64); // 64 hex chars = 32 bytes

function makeProfile(overrides: Record<string, any> = {}) {
    return {
        id: 'profile-1',
        name: 'Test Profile',
        description: null,
        secretKey: `enc:${validHex64}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

// --- getEncryptionProfiles (lines 68-72) ---

describe('getEncryptionProfiles', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns all profiles ordered by createdAt desc', async () => {
        const profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2' })];
        prismaMock.encryptionProfile.findMany.mockResolvedValue(profiles as any);

        const result = await getEncryptionProfiles();

        expect(prismaMock.encryptionProfile.findMany).toHaveBeenCalledWith({
            orderBy: { createdAt: 'desc' },
        });
        expect(result).toHaveLength(2);
    });

    it('returns an empty array when no profiles exist', async () => {
        prismaMock.encryptionProfile.findMany.mockResolvedValue([]);

        const result = await getEncryptionProfiles();

        expect(result).toEqual([]);
    });
});

// --- getEncryptionProfile (lines 77-81) ---

describe('getEncryptionProfile', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the profile when found', async () => {
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);

        const result = await getEncryptionProfile('profile-1');

        expect(prismaMock.encryptionProfile.findUnique).toHaveBeenCalledWith({ where: { id: 'profile-1' } });
        expect(result?.id).toBe('profile-1');
    });

    it('returns null when profile does not exist', async () => {
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(null);

        const result = await getEncryptionProfile('nonexistent');

        expect(result).toBeNull();
    });
});

// --- deleteEncryptionProfile (lines 103-107) ---

describe('deleteEncryptionProfile', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls prisma.delete with the correct id', async () => {
        prismaMock.encryptionProfile.delete.mockResolvedValue(makeProfile() as any);

        await deleteEncryptionProfile('profile-1');

        expect(prismaMock.encryptionProfile.delete).toHaveBeenCalledWith({ where: { id: 'profile-1' } });
    });

    it('propagates prisma errors upward', async () => {
        prismaMock.encryptionProfile.delete.mockRejectedValue(new Error('Foreign key constraint'));

        await expect(deleteEncryptionProfile('profile-1')).rejects.toThrow('Foreign key constraint');
    });
});

// --- getProfileMasterKey error paths (lines 120-129) ---

describe('getProfileMasterKey', () => {
    beforeEach(() => vi.clearAllMocks());

    it('throws when profile is not found (line 121)', async () => {
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(null);

        await expect(getProfileMasterKey('missing-id')).rejects.toThrow(
            'Encryption profile not found: missing-id',
        );
    });

    it('throws Integrity Error when decrypted key is too short (line 127-129)', async () => {
        // Decrypted value is only 32 chars (should be 64).
        const shortHex = 'b'.repeat(32);
        vi.mocked(decrypt).mockReturnValueOnce(shortHex);
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);

        await expect(getProfileMasterKey('profile-1')).rejects.toThrow('Integrity Error');
    });

    it('throws Integrity Error when decrypt returns an empty string (line 127-129)', async () => {
        vi.mocked(decrypt).mockReturnValueOnce('');
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);

        await expect(getProfileMasterKey('profile-1')).rejects.toThrow('Integrity Error');
    });

    it('throws Integrity Error when decrypted key is too long (line 127-129)', async () => {
        vi.mocked(decrypt).mockReturnValueOnce('c'.repeat(128));
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);

        await expect(getProfileMasterKey('profile-1')).rejects.toThrow('Integrity Error');
    });

    it('returns a 32-byte Buffer when the key is valid', async () => {
        vi.mocked(decrypt).mockReturnValueOnce(validHex64);
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);

        const key = await getProfileMasterKey('profile-1');

        expect(Buffer.isBuffer(key)).toBe(true);
        expect(key.length).toBe(32);
    });
});

// --- createEncryptionProfile duplicate name path ---

describe('createEncryptionProfile - duplicate name', () => {
    beforeEach(() => vi.clearAllMocks());

    it('throws when a profile with that name already exists', async () => {
        prismaMock.encryptionProfile.findFirst.mockResolvedValue(makeProfile() as any);

        await expect(createEncryptionProfile('Test Profile')).rejects.toThrow(
            'already exists',
        );

        expect(prismaMock.encryptionProfile.create).not.toHaveBeenCalled();
    });
});

// --- importEncryptionProfile duplicate name path ---

describe('importEncryptionProfile - duplicate name', () => {
    beforeEach(() => vi.clearAllMocks());

    it('throws when a profile with that name already exists', async () => {
        prismaMock.encryptionProfile.findFirst.mockResolvedValue(makeProfile() as any);

        await expect(importEncryptionProfile('Test Profile', validHex64)).rejects.toThrow(
            'already exists',
        );

        expect(prismaMock.encryptionProfile.create).not.toHaveBeenCalled();
    });
});
