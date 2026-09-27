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
    deleteBlockerOf,
    findProfileByKey,
    getProfileMasterKey,
    createEncryptionProfile,
    importEncryptionProfile,
    markRecoveryKit,
} from '@/services/backup/encryption-service';
import { decrypt } from '@/lib/crypto';
import { ConflictError, NotFoundError } from '@/lib/logging/errors';

// --- Test fixtures ---

// Every profile the service hands back leaves out its key, see summaryFields in the service.
const SUMMARY = { id: true, name: true, description: true, kitDownloadedAt: true, createdAt: true, updatedAt: true };

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

    it('returns all profiles ordered by createdAt desc, with how many jobs use each', async () => {
        const profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2' })];
        prismaMock.encryptionProfile.findMany.mockResolvedValue(profiles as any);

        const result = await getEncryptionProfiles();

        expect(prismaMock.encryptionProfile.findMany).toHaveBeenCalledWith({
            select: { ...SUMMARY, _count: { select: { jobs: true } } },
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

        expect(prismaMock.encryptionProfile.findUnique).toHaveBeenCalledWith({ where: { id: 'profile-1' }, select: SUMMARY });
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
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ id: 'profile-1' } as any);
        prismaMock.job.count.mockResolvedValue(0);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
    });

    it('calls prisma.delete with the correct id', async () => {
        prismaMock.encryptionProfile.delete.mockResolvedValue(makeProfile() as any);

        await deleteEncryptionProfile('profile-1');

        expect(prismaMock.encryptionProfile.delete).toHaveBeenCalledWith({ where: { id: 'profile-1' }, select: SUMMARY });
    });

    it('propagates prisma errors upward', async () => {
        prismaMock.encryptionProfile.delete.mockRejectedValue(new Error('Foreign key constraint'));

        await expect(deleteEncryptionProfile('profile-1')).rejects.toThrow('Foreign key constraint');
    });

    // The relation is ON DELETE SET NULL, so a delete would quietly store the next backups in the clear.
    it('refuses a key that jobs still encrypt with', async () => {
        prismaMock.job.count.mockResolvedValue(2);

        await expect(deleteEncryptionProfile('profile-1')).rejects.toThrow(ConflictError);
        await expect(deleteEncryptionProfile('profile-1')).rejects.toThrow('2 jobs encrypt with this key');
        expect(prismaMock.encryptionProfile.delete).not.toHaveBeenCalled();
    });

    it('refuses the key of the config backup', async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'config.backup.profileId', value: 'profile-1' } as any);

        await expect(deleteEncryptionProfile('profile-1')).rejects.toThrow('the config backup encrypts with this key');
        expect(prismaMock.encryptionProfile.delete).not.toHaveBeenCalled();
    });

    it('names both when a job and the config backup use the key', async () => {
        prismaMock.job.count.mockResolvedValue(1);
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: 'config.backup.profileId', value: 'profile-1' } as any);

        expect(await deleteBlockerOf('profile-1')).toBe('1 job and the config backup encrypt with this key. Pick another key there first.');
    });

    it('answers a key that is gone with NotFoundError', async () => {
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(null);

        await expect(deleteEncryptionProfile('missing')).rejects.toThrow(NotFoundError);
    });
});

// --- the recovery kit and the lookup by key ---

describe('markRecoveryKit', () => {
    beforeEach(() => vi.clearAllMocks());

    it('notes the time on every key of the kit', async () => {
        await markRecoveryKit(['a', 'b']);

        expect(prismaMock.encryptionProfile.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['a', 'b'] } },
            data: { kitDownloadedAt: expect.any(Date) },
        });
    });
});

describe('findProfileByKey', () => {
    beforeEach(() => vi.clearAllMocks());

    it('hands back only the id and the name of the profile that holds the key', async () => {
        prismaMock.encryptionProfile.findMany.mockResolvedValue([
            makeProfile({ id: 'p1', name: 'One', secretKey: `enc:${'b'.repeat(64)}` }),
            makeProfile({ id: 'p2', name: 'Two', secretKey: `enc:${validHex64}` }),
        ] as any);

        expect(await findProfileByKey(validHex64.toUpperCase())).toEqual({ id: 'p2', name: 'Two' });
    });

    it('skips a key the system key no longer opens', async () => {
        vi.mocked(decrypt).mockImplementationOnce(() => { throw new Error('bad tag'); });
        prismaMock.encryptionProfile.findMany.mockResolvedValue([makeProfile({ id: 'p1' })] as any);

        expect(await findProfileByKey(validHex64)).toBeNull();
    });
});

describe('importEncryptionProfile - the same key twice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('refuses a key the Vault holds already', async () => {
        prismaMock.encryptionProfile.findFirst.mockResolvedValue(null);
        prismaMock.encryptionProfile.findMany.mockResolvedValue([makeProfile({ id: 'p1', name: 'Production' })] as any);

        await expect(importEncryptionProfile('Copy', validHex64)).rejects.toThrow('This key is in the Vault already, as "Production".');
        expect(prismaMock.encryptionProfile.create).not.toHaveBeenCalled();
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

// --- the key stays on the server ---

describe('profiles handed back by the service', () => {
    beforeEach(() => vi.clearAllMocks());

    it('never ask the database for the key, so no Server Action can pass it to the browser', async () => {
        prismaMock.encryptionProfile.findFirst.mockResolvedValue(null);
        prismaMock.encryptionProfile.create.mockResolvedValue(makeProfile() as any);
        prismaMock.encryptionProfile.findMany.mockResolvedValue([]);
        prismaMock.encryptionProfile.findUnique.mockResolvedValue(makeProfile() as any);
        prismaMock.encryptionProfile.delete.mockResolvedValue(makeProfile() as any);
        prismaMock.job.count.mockResolvedValue(0);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);

        await createEncryptionProfile('New key');
        await importEncryptionProfile('Imported key', validHex64);
        await getEncryptionProfiles();
        await getEncryptionProfile('profile-1');
        await deleteEncryptionProfile('profile-1');

        // The lookups that only compare keys or check a profile is there hand nothing back, see findProfileByKey.
        const selectOf = (args: unknown) => (args as { select?: Record<string, unknown> } | undefined)?.select ?? {};
        const calls = [
            ...prismaMock.encryptionProfile.create.mock.calls,
            ...prismaMock.encryptionProfile.findMany.mock.calls.filter(([args]) => !('secretKey' in selectOf(args))),
            ...prismaMock.encryptionProfile.findUnique.mock.calls.filter(([args]) => 'name' in selectOf(args)),
            ...prismaMock.encryptionProfile.delete.mock.calls,
        ];
        expect(calls).toHaveLength(5);
        for (const [args] of calls) {
            expect(args).toMatchObject({ select: SUMMARY });
            expect((args as { select: Record<string, unknown> }).select).not.toHaveProperty('secretKey');
        }
    });
});
