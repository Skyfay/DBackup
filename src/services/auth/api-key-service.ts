import { randomBytes, createHash, scryptSync } from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { ApiKeyError, NotFoundError, wrapError } from "@/lib/logging/errors";
import { Permission } from "@/lib/auth/permissions";
import { capToOwner } from "@/lib/auth/owner-permissions";
import { runBulk, type BulkResult } from "@/lib/core/bulk";

const log = logger.child({ service: "ApiKeyService" });

const API_KEY_PREFIX = "dbackup_";
const KEY_BYTE_LENGTH = 30; // 30 bytes = 60 hex chars
/** What the list shows of a key: "dbackup_" and its first 8 hex characters. */
const PREFIX_LENGTH = 16;
const SCRYPT_SALT = "dbackup-api-key-scrypt-v1";
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash a raw API key using scrypt (CWE-916 compliant)
 */
function hashKey(rawKey: string): string {
  return scryptSync(rawKey, SCRYPT_SALT, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString("hex");
}

/**
 * Legacy hash for migrating existing keys (plain SHA-256, used pre-v1.4.2)
 */
function hashKeyLegacy(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generate a new raw API key with the dbackup_ prefix
 */
function generateRawKey(): string {
  const randomPart = randomBytes(KEY_BYTE_LENGTH).toString("hex");
  return `${API_KEY_PREFIX}${randomPart}`;
}

export interface CreateApiKeyInput {
  name: string;
  permissions: Permission[];
  userId: string;
  expiresAt?: Date | null;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  userId: string;
  userName?: string;
  userEmail?: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  enabled: boolean;
  createdAt: Date;
}

export interface ValidatedApiKey {
  id: string;
  userId: string;
  permissions: string[];
}

export class ApiKeyService {
  /**
   * Create a new API key. Returns the raw key ONCE - it cannot be retrieved again.
   */
  async create(input: CreateApiKeyInput): Promise<{ apiKey: ApiKeyListItem; rawKey: string }> {
    const rawKey = generateRawKey();
    const hashed = hashKey(rawKey);
    const prefix = rawKey.substring(0, PREFIX_LENGTH);

    const record = await prisma.apiKey.create({
      data: {
        name: input.name,
        prefix,
        hashedKey: hashed,
        permissions: JSON.stringify(input.permissions),
        userId: input.userId,
        expiresAt: input.expiresAt ?? null,
      },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    log.info("API key created", { apiKeyId: record.id, userId: input.userId, name: input.name });

    const apiKey: ApiKeyListItem = {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      permissions: JSON.parse(record.permissions),
      userId: record.userId,
      userName: record.user.name,
      userEmail: record.user.email,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      enabled: record.enabled,
      createdAt: record.createdAt,
    };

    return { apiKey, rawKey };
  }

  /**
   * List all API keys (optionally filtered by userId). Never returns the hashed key.
   */
  async list(userId?: string): Promise<ApiKeyListItem[]> {
    const where = userId ? { userId } : {};

    const records = await prisma.apiKey.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return records.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      permissions: JSON.parse(r.permissions) as string[],
      userId: r.userId,
      userName: r.user.name,
      userEmail: r.user.email,
      expiresAt: r.expiresAt,
      lastUsedAt: r.lastUsedAt,
      enabled: r.enabled,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get a single API key by ID
   */
  async getById(id: string): Promise<ApiKeyListItem> {
    const record = await prisma.apiKey.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    if (!record) {
      throw new NotFoundError("ApiKey", id);
    }

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      permissions: JSON.parse(record.permissions) as string[],
      userId: record.userId,
      userName: record.user.name,
      userEmail: record.user.email,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      enabled: record.enabled,
      createdAt: record.createdAt,
    };
  }

  /**
   * Delete an API key by ID
   */
  async delete(id: string): Promise<void> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    await prisma.apiKey.delete({ where: { id } });
    log.info("API key deleted", { apiKeyId: id });
  }

  /** Deletes several API keys, reporting per-key outcomes. */
  async deleteMany(ids: string[]): Promise<BulkResult> {
    const names = await this.namesById(ids);
    return runBulk(ids, (id) => this.delete(id), (id) => names.get(id));
  }

  /**
   * Enables or disables several API keys.
   *
   * Absolute rather than a toggle, so a mixed selection converges on one state.
   */
  async toggleMany(ids: string[], enabled: boolean): Promise<BulkResult> {
    const names = await this.namesById(ids);
    return runBulk(ids, (id) => this.toggle(id, enabled).then(() => undefined), (id) => names.get(id));
  }

  /** Names for the failure list, read before a delete makes them unreadable. */
  private async namesById(ids: string[]): Promise<Map<string, string>> {
    const keys = await prisma.apiKey.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(keys.map((key) => [key.id, key.name]));
  }

  /**
   * Enable or disable an API key
   */
  async toggle(id: string, enabled: boolean): Promise<ApiKeyListItem> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    const record = await prisma.apiKey.update({
      where: { id },
      data: { enabled },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    log.info("API key toggled", { apiKeyId: id, enabled });

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      permissions: JSON.parse(record.permissions) as string[],
      userId: record.userId,
      userName: record.user.name,
      userEmail: record.user.email,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      enabled: record.enabled,
      createdAt: record.createdAt,
    };
  }

  /**
   * Rotate an API key - generates a new key, replaces the hash. Returns new raw key ONCE.
   */
  async rotate(id: string): Promise<{ apiKey: ApiKeyListItem; rawKey: string }> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    const rawKey = generateRawKey();
    const hashed = hashKey(rawKey);
    // The same length as a new key, the list tells keys apart by it.
    const prefix = rawKey.substring(0, PREFIX_LENGTH);

    const record = await prisma.apiKey.update({
      where: { id },
      data: { hashedKey: hashed, prefix },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    log.info("API key rotated", { apiKeyId: id });

    const apiKey: ApiKeyListItem = {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      permissions: JSON.parse(record.permissions) as string[],
      userId: record.userId,
      userName: record.user.name,
      userEmail: record.user.email,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      enabled: record.enabled,
      createdAt: record.createdAt,
    };

    return { apiKey, rawKey };
  }

  /**
   * Whether another key has this name already, in any case. Runs name the key they came from by
   * its name, so two keys never share one.
   */
  async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    const keys = await prisma.apiKey.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { name: true } });
    const wanted = name.trim().toLowerCase();
    return keys.some((key) => key.name.trim().toLowerCase() === wanted);
  }

  /** The owner of a key with their group, which decides the most the key may get, and what the key holds. */
  async ownerOf(id: string) {
    const record = await prisma.apiKey.findUnique({
      where: { id },
      select: { userId: true, name: true, permissions: true, user: { select: { group: { select: { name: true, permissions: true } } } } },
    });
    if (!record) {
      throw new NotFoundError("ApiKey", id);
    }
    return { ownerId: record.userId, name: record.name, permissions: JSON.parse(record.permissions) as string[], group: record.user.group };
  }

  /**
   * Changes the name, the permissions and the end of a key, and says what they were before. The
   * secret stays, so scripts that use it keep working.
   */
  async update(id: string, input: { name: string; permissions: Permission[]; expiresAt: Date | null }) {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    await prisma.apiKey.update({
      where: { id },
      data: { name: input.name, permissions: JSON.stringify(input.permissions), expiresAt: input.expiresAt },
    });
    log.info("API key updated", { apiKeyId: id });

    return {
      before: { name: existing.name, permissions: JSON.parse(existing.permissions) as string[], expiresAt: existing.expiresAt },
      after: input,
    };
  }

  /**
   * Validate a raw API key from an Authorization header.
   * Returns the API key data if valid, null if invalid.
   * Updates lastUsedAt on successful validation.
   */
  async validate(rawKey: string): Promise<ValidatedApiKey | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const hashed = hashKey(rawKey);

    // The group of the owner decides the most the key may do, at every request.
    const withOwner = { user: { select: { group: { select: { name: true, permissions: true } } } } } as const;
    let record = await prisma.apiKey.findUnique({
      where: { hashedKey: hashed },
      include: withOwner,
    });

    // Fallback: try legacy SHA-256 hash for keys created before v1.4.2
    if (!record) {
      const legacyHashed = hashKeyLegacy(rawKey);
      record = await prisma.apiKey.findUnique({
        where: { hashedKey: legacyHashed },
        include: withOwner,
      });

      if (record) {
        await prisma.apiKey.update({
          where: { id: record.id },
          data: { hashedKey: hashed },
        });
        log.info("Migrated API key hash from SHA-256 to scrypt", { apiKeyId: record.id });
      }
    }

    if (!record) {
      log.warn("API key validation failed: key not found", { prefix: rawKey.substring(0, 12) });
      return null;
    }

    if (!record.enabled) {
      log.warn("API key validation failed: key disabled", { apiKeyId: record.id });
      throw new ApiKeyError("disabled", "API key is disabled");
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      log.warn("API key validation failed: key expired", { apiKeyId: record.id });
      throw new ApiKeyError("expired", "API key has expired");
    }

    // Update lastUsedAt (fire-and-forget for performance)
    prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => {
        log.error("Failed to update lastUsedAt for API key", { apiKeyId: record.id }, wrapError(err));
      });

    // A permission the group of the owner no longer has stays stored but does nothing.
    return {
      id: record.id,
      userId: record.userId,
      permissions: capToOwner(JSON.parse(record.permissions) as string[], record.user?.group),
    };
  }
}

export const apiKeyService = new ApiKeyService();
