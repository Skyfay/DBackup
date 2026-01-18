import prisma from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/crypto';
import crypto from 'crypto';

/**
 * Creates a new encryption profile with a secure, auto-generated key.
 */
export async function createEncryptionProfile(name: string, description?: string) {
  // Generate a new random 32-byte key for this profile
  const masterKeyBuffer = crypto.randomBytes(32);
  const masterKeyHex = masterKeyBuffer.toString('hex');

  // Encrypt the master key with our system key before storing
  const encryptedMasterKey = encrypt(masterKeyHex);

  const profile = await prisma.encryptionProfile.create({
    data: {
      name,
      description,
      secretKey: encryptedMasterKey,
    },
  });

  return profile;
}

/**
 * Returns all encryption profiles.
 */
export async function getEncryptionProfiles() {
  return await prisma.encryptionProfile.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Returns a single encryption profile by ID.
 */
export async function getEncryptionProfile(id: string) {
    return await prisma.encryptionProfile.findUnique({
        where: { id }
    });
}

/**
 * Returns the decrypted master key (hex string) for a specific profile.
 * SECURITY: Only use this when strictly necessary (e.g. performing backup/restore or explicit export).
 */
export async function getDecryptedMasterKey(id: string): Promise<string> {
    const profile = await prisma.encryptionProfile.findUnique({
        where: { id }
    });

    if (!profile) {
        throw new Error(`Encryption profile ${id} not found`);
    }

    return decrypt(profile.secretKey);
}

/**
 * Deletes an encryption profile.
 * WARNING: This will render all backups using this profile permanently unreadable.
 */
export async function deleteEncryptionProfile(id: string) {
  return await prisma.encryptionProfile.delete({
    where: { id },
  });
}

/**
 * Retrieves the raw 32-byte Buffer key for a profile.
 * THIS IS CRITICAL SECURITY CODE.
 * Only use this internally within Runner/Restore services.
 * Never expose this value via API directly.
 */
export async function getProfileMasterKey(profileId: string): Promise<Buffer> {
  const profile = await prisma.encryptionProfile.findUnique({
    where: { id: profileId },
  });

  if (!profile) {
    throw new Error(`Encryption profile not found: ${profileId}`);
  }

  // Decrypt the stored secret to get the hex string of the master key
  const masterKeyHex = decrypt(profile.secretKey);

  if (!masterKeyHex || masterKeyHex.length !== 64) {
      throw new Error("Integrity Error: Decrypted master key has invalid length or format.");
  }

  return Buffer.from(masterKeyHex, 'hex');
}
