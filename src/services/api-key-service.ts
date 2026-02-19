import { randomBytes, createHash } from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ApiKeyError, NotFoundError, wrapError } from "@/lib/errors";
import { Permission } from "@/lib/permissions";

const log = logger.child({ service: "ApiKeyService" });

const API_KEY_PREFIX = "dbackup_";
const KEY_BYTE_LENGTH = 30; // 30 bytes = 40 hex chars

/**
 * Hash a raw API key using SHA-256
 */
function hashKey(rawKey: string): string {
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
   * Create a new API key. Returns the raw key ONCE — it cannot be retrieved again.
   */
  async create(input: CreateApiKeyInput): Promise<{ apiKey: ApiKeyListItem; rawKey: string }> {
    const rawKey = generateRawKey();
    const hashed = hashKey(rawKey);
    const prefix = rawKey.substring(0, 16); // "dbackup_" + 8 hex chars

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
   * Rotate an API key — generates a new key, replaces the hash. Returns new raw key ONCE.
   */
  async rotate(id: string): Promise<{ apiKey: ApiKeyListItem; rawKey: string }> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    const rawKey = generateRawKey();
    const hashed = hashKey(rawKey);
    const prefix = rawKey.substring(0, 12);

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
   * Update the permissions of an API key
   */
  async updatePermissions(id: string, permissions: Permission[]): Promise<ApiKeyListItem> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("ApiKey", id);
    }

    const record = await prisma.apiKey.update({
      where: { id },
      data: { permissions: JSON.stringify(permissions) },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    log.info("API key permissions updated", { apiKeyId: id });

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
   * Validate a raw API key from an Authorization header.
   * Returns the API key data if valid, null if invalid.
   * Updates lastUsedAt on successful validation.
   */
  async validate(rawKey: string): Promise<ValidatedApiKey | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const hashed = hashKey(rawKey);

    const record = await prisma.apiKey.findUnique({
      where: { hashedKey: hashed },
    });

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

    return {
      id: record.id,
      userId: record.userId,
      permissions: JSON.parse(record.permissions) as string[],
    };
  }
}

export const apiKeyService = new ApiKeyService();
