import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEncryptionProfile, importEncryptionProfile, updateEncryptionProfile, getDecryptedMasterKey, getProfileMasterKey } from '@/services/backup/encryption-service';
import { ConflictError, NotFoundError } from '@/lib/logging/errors';
import prisma from '@/lib/prisma';
import * as cryptoLib from '@/lib/crypto';
import crypto from 'crypto';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  default: {
    encryptionProfile: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
  }
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

// We can spy on crypto.randomBytes to ensure deterministic key generation for testing
// Using a fixed 32-byte sequence
const FIXED_KEY_BUFFER = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => {
    if (size === 32) return FIXED_KEY_BUFFER;
    return Buffer.alloc(size);
});

// Every profile the service hands back leaves out its key, see summaryFields in the service.
const SUMMARY = { id: true, name: true, description: true, createdAt: true, updatedAt: true };

describe('Encryption Service', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createEncryptionProfile', () => {
        it('should encrypt the generated master key before saving to DB', async () => {
            const mockEncrypted = 'encrypted-secret-value';
            (cryptoLib.encrypt as any).mockReturnValue(mockEncrypted);

            const fixedKeyHex = FIXED_KEY_BUFFER.toString('hex');

            (prisma.encryptionProfile.findFirst as any).mockResolvedValue(null);
            (prisma.encryptionProfile.create as any).mockResolvedValue({ id: '1', name: 'Test', secretKey: mockEncrypted });

            await createEncryptionProfile('Test Profile', 'Desc');

            // 1. Verify encrypt was called with the HEX string of the random bytes
            expect(cryptoLib.encrypt).toHaveBeenCalledWith(fixedKeyHex);

            // 2. Verify DB create was called with the RESULT of encrypt(), NOT the raw key
            expect(prisma.encryptionProfile.create).toHaveBeenCalledWith({
                data: {
                    name: 'Test Profile',
                    description: 'Desc',
                    secretKey: mockEncrypted // Validation: Plaintext key never touches DB args
                },
                select: SUMMARY,
            });

            // 3. Verify it never tried to save the fixedKeyHex directly
            expect(prisma.encryptionProfile.create).not.toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ secretKey: fixedKeyHex })
            }));
        });
    });

    describe('importEncryptionProfile', () => {
        it('should validate hex string length', async () => {
            (prisma.encryptionProfile.findFirst as any).mockResolvedValue(null);
            await expect(importEncryptionProfile('Test', 'shorts')).rejects.toThrow('Invalid key format');
            await expect(importEncryptionProfile('Test', 'zz'.repeat(32))).rejects.toThrow('Invalid key format'); // valid length, invalid chars
        });

        it('should encrypt the imported key before saving', async () => {
            const validKeyHex = '00'.repeat(32); // 64 chars
            const mockEncrypted = 'encrypted-imported-value';
            (cryptoLib.encrypt as any).mockReturnValue(mockEncrypted);
            (prisma.encryptionProfile.findFirst as any).mockResolvedValue(null);
            (prisma.encryptionProfile.create as any).mockResolvedValue({ id: '2', name: 'Imported', secretKey: mockEncrypted });

            await importEncryptionProfile('Imported Key', validKeyHex, 'Desc');

            // 1. Verify encrypt was called with the provided hex
            expect(cryptoLib.encrypt).toHaveBeenCalledWith(validKeyHex);

            // 2. Verify DB create
            expect(prisma.encryptionProfile.create).toHaveBeenCalledWith({
                data: {
                    name: 'Imported Key',
                    description: 'Desc',
                    secretKey: mockEncrypted
                },
                select: SUMMARY,
            });
        });
    });

    describe('updateEncryptionProfile', () => {
        const existing = { id: '1', name: 'Old Name', description: 'Old Desc', secretKey: 'encrypted-stuff' };

        it('should rename the profile and update the description without touching the key', async () => {
            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(existing);
            (prisma.encryptionProfile.findFirst as any).mockResolvedValue(null);
            (prisma.encryptionProfile.update as any).mockResolvedValue({ ...existing, name: 'New Name', description: 'New Desc' });

            const result = await updateEncryptionProfile('1', { name: 'New Name', description: 'New Desc' });

            expect(prisma.encryptionProfile.findFirst).toHaveBeenCalledWith({ where: { name: 'New Name', NOT: { id: '1' } } });
            expect(prisma.encryptionProfile.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: { name: 'New Name', description: 'New Desc' },
                select: SUMMARY,
            });
            expect(result.previousName).toBe('Old Name');
            expect(result.profile.name).toBe('New Name');
        });

        it('should reject a name another profile already uses', async () => {
            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(existing);
            (prisma.encryptionProfile.findFirst as any).mockResolvedValue({ id: '2', name: 'Taken' });

            await expect(updateEncryptionProfile('1', { name: 'Taken' })).rejects.toThrow(ConflictError);
            expect(prisma.encryptionProfile.update).not.toHaveBeenCalled();
        });

        it('should skip the name check when the name is unchanged', async () => {
            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(existing);
            (prisma.encryptionProfile.update as any).mockResolvedValue({ ...existing, description: null });

            await updateEncryptionProfile('1', { name: 'Old Name', description: null });

            expect(prisma.encryptionProfile.findFirst).not.toHaveBeenCalled();
            expect(prisma.encryptionProfile.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: { description: null },
                select: SUMMARY,
            });
        });

        it('should throw if profile not found', async () => {
            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(null);

            await expect(updateEncryptionProfile('missing', { name: 'Any' })).rejects.toThrow(NotFoundError);
            expect(prisma.encryptionProfile.update).not.toHaveBeenCalled();
        });
    });

    describe('getDecryptedMasterKey', () => {
        it('should retrieve and decrypt the key', async () => {
            const mockProfile = { id: '1', secretKey: 'encrypted-stuff' };
            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(mockProfile);
            (cryptoLib.decrypt as any).mockReturnValue('decrypted-hex-key');

            const result = await getDecryptedMasterKey('1');

            expect(prisma.encryptionProfile.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
            expect(cryptoLib.decrypt).toHaveBeenCalledWith('encrypted-stuff');
            expect(result).toBe('decrypted-hex-key');
        });

        it('should throw if profile not found', async () => {
             (prisma.encryptionProfile.findUnique as any).mockResolvedValue(null);
             await expect(getDecryptedMasterKey('missing')).rejects.toThrow('Encryption profile missing not found');
        });
    });

     describe('getProfileMasterKey', () => {
        it('should return the key as a Buffer', async () => {
            const mockProfile = { id: '1', secretKey: 'encrypted-stuff' };
            const fakeHexKey = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'; // 32 bytes hex

            (prisma.encryptionProfile.findUnique as any).mockResolvedValue(mockProfile);
            (cryptoLib.decrypt as any).mockReturnValue(fakeHexKey);

            const result = await getProfileMasterKey('1');

            expect(Buffer.isBuffer(result)).toBe(true);
            expect(result.toString('hex')).toBe(fakeHexKey);
            expect(result.length).toBe(32);
        });

        it('should throw integrity error if decrypted key is invalid length', async () => {
             const mockProfile = { id: '1', secretKey: 'encrypted-stuff' };
             (prisma.encryptionProfile.findUnique as any).mockResolvedValue(mockProfile);
             (cryptoLib.decrypt as any).mockReturnValue('short-key'); // Not 64 chars hex

             await expect(getProfileMasterKey('1')).rejects.toThrow('Integrity Error');
        });
    });
});
