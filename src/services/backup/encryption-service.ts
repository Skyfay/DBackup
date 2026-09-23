import type { EncryptionProfile, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runBulk, type BulkResult } from '@/lib/core/bulk';
import { encrypt, decrypt } from '@/lib/crypto';
import { ConflictError, NotFoundError } from '@/lib/logging/errors';
import crypto from 'crypto';

/** A profile as it may leave this service: everything but its key. */
export type EncryptionProfileSummary = Omit<EncryptionProfile, 'secretKey'>;

/**
 * The fields of every profile this service returns. The results reach the browser through the
 * Server Actions, so the key stays out even in its encrypted form. It only leaves through
 * getDecryptedMasterKey and getProfileMasterKey, by id.
 */
const summaryFields = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EncryptionProfileSelect;

/**
 * Creates a new encryption profile with a secure, auto-generated key.
 */
export async function createEncryptionProfile(name: string, description?: string): Promise<EncryptionProfileSummary> {
  // Check name uniqueness
  const existingByName = await prisma.encryptionProfile.findFirst({ where: { name } });
  if (existingByName) {
    throw new Error(`An encryption profile with the name "${name}" already exists.`);
  }

  // Generate a new random 32-byte key for this profile
  const masterKeyBuffer = crypto.randomBytes(32);
  const masterKeyHex = masterKeyBuffer.toString('hex');

  // Encrypt the master key with our system key before storing
  const encryptedMasterKey = encrypt(masterKeyHex);

  return await prisma.encryptionProfile.create({
    data: {
      name,
      description,
      secretKey: encryptedMasterKey,
    },
    select: summaryFields,
  });
}

/**
 * Imports an existing encryption key.
 * Validates the hex format (32 bytes = 64 chars) before storing.
 */
export async function importEncryptionProfile(name: string, keyHex: string, description?: string): Promise<EncryptionProfileSummary> {
  // Check name uniqueness
  const existingByName = await prisma.encryptionProfile.findFirst({ where: { name } });
  if (existingByName) {
    throw new Error(`An encryption profile with the name "${name}" already exists.`);
  }

  // 1. Validate Format
  const cleanKey = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    throw new Error("Invalid key format. Must be a 32-byte Hex string (64 characters).");
  }

  // 2. Encrypt with system key
  const encryptedMasterKey = encrypt(cleanKey);

  // 3. Store
  return await prisma.encryptionProfile.create({
    data: {
      name,
      description,
      secretKey: encryptedMasterKey,
    },
    select: summaryFields,
  });
}

/**
 * Returns all encryption profiles, newest first, without their keys.
 */
export async function getEncryptionProfiles(): Promise<EncryptionProfileSummary[]> {
  return await prisma.encryptionProfile.findMany({
    select: summaryFields,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Returns a single encryption profile by ID, without its key.
 */
export async function getEncryptionProfile(id: string): Promise<EncryptionProfileSummary | null> {
    return await prisma.encryptionProfile.findUnique({
        where: { id },
        select: summaryFields,
    });
}

/**
 * Updates the name and description of an encryption profile. The key itself never changes.
 *
 * Renaming is safe for existing backups because they record the profile id, not its name.
 * Returns the previous name so callers can record the rename.
 */
export async function updateEncryptionProfile(
  id: string,
  updates: { name?: string; description?: string | null }
) {
  const existing = await prisma.encryptionProfile.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("EncryptionProfile", id);
  }

  const patch: { name?: string; description?: string | null } = {};

  if (updates.name !== undefined && updates.name !== existing.name) {
    const conflict = await prisma.encryptionProfile.findFirst({
      where: { name: updates.name, NOT: { id } },
    });
    if (conflict) {
      throw new ConflictError(`An encryption profile with the name "${updates.name}" already exists.`);
    }
    patch.name = updates.name;
  }

  if (updates.description !== undefined) {
    patch.description = updates.description;
  }

  const profile = await prisma.encryptionProfile.update({
    where: { id },
    data: patch,
    select: summaryFields,
  });

  return { profile, previousName: existing.name };
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
export async function deleteEncryptionProfile(id: string): Promise<EncryptionProfileSummary> {
  return await prisma.encryptionProfile.delete({
    where: { id },
    select: summaryFields,
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

/**
 * Deletes several encryption profiles, reporting per-profile outcomes.
 *
 * WARNING: as with the single delete, every backup encrypted with a removed profile
 * becomes permanently unreadable.
 */
export async function deleteEncryptionProfiles(ids: string[]): Promise<BulkResult> {
  const profiles = await prisma.encryptionProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));

  return runBulk(ids, (id) => deleteEncryptionProfile(id).then(() => undefined), (id) => names.get(id));
}
