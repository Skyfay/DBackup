import type { EncryptionProfile, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runBulk, type BulkResult } from '@/lib/core/bulk';
import { encrypt, decrypt } from '@/lib/crypto';
import { ConflictError, NotFoundError } from '@/lib/logging/errors';
import crypto from 'crypto';
import { isKeyHex, keyIdOf } from '@/services/vault/key-id';

/** A profile as it may leave this service: everything but its key and the ids it stands for. */
export type EncryptionProfileSummary = Omit<EncryptionProfile, 'secretKey' | 'aliases'>;

/**
 * The fields of every profile this service returns. The results reach the browser through the
 * Server Actions, so the key stays out even in its encrypted form. It only leaves through
 * getDecryptedMasterKey and getProfileMasterKey, by id.
 */
const summaryFields = {
  id: true,
  name: true,
  description: true,
  kitDownloadedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EncryptionProfileSelect;

/** The setting that names the key of the config backup. */
const CONFIG_BACKUP_KEY_SETTING = 'config.backup.profileId';

/**
 * Creates a new encryption profile with a secure, auto-generated key.
 */
export async function createEncryptionProfile(name: string, description?: string): Promise<EncryptionProfileSummary & { keyId: string }> {
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

  const profile = await prisma.encryptionProfile.create({
    data: {
      name,
      description,
      secretKey: encryptedMasterKey,
    },
    select: summaryFields,
  });
  // The Key ID, so the dialog that made the key can name it without ever seeing the key.
  return { ...profile, keyId: keyIdOf(masterKeyHex) };
}

/**
 * Imports an existing encryption key.
 * Validates the hex format (32 bytes = 64 chars) before storing.
 */
export async function importEncryptionProfile(
  name: string,
  keyHex: string,
  description?: string,
  // The profile ids the key had before, like in the index of a recovery kit, so the Vault
  // counts the backups that name them under this key.
  standsFor: string[] = []
): Promise<EncryptionProfileSummary> {
  // Check name uniqueness
  const existingByName = await prisma.encryptionProfile.findFirst({ where: { name } });
  if (existingByName) {
    throw new Error(`An encryption profile with the name "${name}" already exists.`);
  }

  // 1. Validate Format
  const cleanKey = keyHex.trim();
  if (!isKeyHex(cleanKey)) {
    throw new Error("Invalid key format. Must be a 32-byte Hex string (64 characters).");
  }

  // A second profile with the same key opens nothing the first does not, and makes it unclear
  // which of the two a kit or a restore should use.
  const twin = await findProfileByKey(cleanKey);
  if (twin) {
    throw new ConflictError(`This key is in the Vault already, as "${twin.name}".`);
  }

  // 2. Encrypt with system key
  const encryptedMasterKey = encrypt(cleanKey);

  // 3. Store
  return await prisma.encryptionProfile.create({
    data: {
      name,
      description,
      secretKey: encryptedMasterKey,
      ...(standsFor.length > 0 ? { aliases: JSON.stringify([...new Set(standsFor)]) } : {}),
    },
    select: summaryFields,
  });
}

/** A profile in the list, with how many jobs encrypt their backups with it. */
export type ListedEncryptionProfile = EncryptionProfileSummary & { _count: { jobs: number } };

/**
 * Returns all encryption profiles, newest first, without their keys and with how many jobs use each.
 */
export async function getEncryptionProfiles(): Promise<ListedEncryptionProfile[]> {
  return await prisma.encryptionProfile.findMany({
    select: { ...summaryFields, _count: { select: { jobs: true } } },
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
 * Why a key cannot be deleted yet, or null.
 *
 * A job keeps its reference only loosely: the relation is `ON DELETE SET NULL`, so deleting its
 * key would quietly turn off its encryption and store its next backups in the clear. The config
 * backup names its key in a setting and would do the same without secrets, so both hold a key.
 */
export async function deleteBlockerOf(id: string): Promise<string | null> {
  const [jobs, configKey] = await Promise.all([
    prisma.job.count({ where: { encryptionProfileId: id } }),
    prisma.systemSetting.findUnique({ where: { key: CONFIG_BACKUP_KEY_SETTING }, select: { value: true } }),
  ]);
  const users = [
    ...(jobs > 0 ? [`${jobs} job${jobs === 1 ? '' : 's'}`] : []),
    ...(configKey?.value === id ? ['the config backup'] : []),
  ];
  if (users.length === 0) return null;
  const verb = jobs > 1 || users.length > 1 ? 'encrypt' : 'encrypts';
  return `${users.join(' and ')} ${verb} with this key. Pick another key there first.`;
}

/**
 * Deletes an encryption profile. Refused while a job or the config backup encrypts with it.
 * WARNING: This will render all backups using this profile permanently unreadable.
 */
export async function deleteEncryptionProfile(id: string): Promise<EncryptionProfileSummary> {
  const existing = await prisma.encryptionProfile.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new NotFoundError("EncryptionProfile", id);
  }
  const blocker = await deleteBlockerOf(id);
  if (blocker) {
    throw new ConflictError(blocker, { context: { id } });
  }
  return await prisma.encryptionProfile.delete({
    where: { id },
    select: summaryFields,
  });
}

/** Notes on the keys that a recovery kit with them was just made, which the Vault warns about until then. */
export async function markRecoveryKit(ids: string[]): Promise<void> {
  await prisma.encryptionProfile.updateMany({
    where: { id: { in: ids } },
    data: { kitDownloadedAt: new Date() },
  });
}

/**
 * The profile that holds this key, or null. Decrypts every key once, which is cheap for the
 * handful a Vault holds.
 */
export async function findProfileByKey(keyHex: string): Promise<{ id: string; name: string } | null> {
  const wanted = Buffer.from(keyHex.trim(), 'hex');
  const profiles = await prisma.encryptionProfile.findMany({ select: { id: true, name: true, secretKey: true } });
  for (const profile of profiles) {
    try {
      const stored = Buffer.from(decrypt(profile.secretKey), 'hex');
      if (stored.length === wanted.length && crypto.timingSafeEqual(stored, wanted)) return { id: profile.id, name: profile.name };
    } catch {
      // A key the system key no longer opens cannot be the same one.
    }
  }
  return null;
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
