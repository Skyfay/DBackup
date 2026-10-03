import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, scryptSync } from "crypto";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ApiKeyService, CreateApiKeyInput } from "@/services/auth/api-key-service";
import { ApiKeyError, NotFoundError } from "@/lib/logging/errors";

// Mock logger
vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe("ApiKeyService", () => {
  let service: ApiKeyService;

  const mockUser = { name: "Test User", email: "test@test.com" };
  /** An owner whose group allows everything the keys below hold. */
  const owner = { group: { name: "Operators", permissions: '["jobs:read","jobs:execute","history:read"]' } };

  beforeEach(() => {
    service = new ApiKeyService();
    vi.clearAllMocks();
  });

  // ========================================================================
  // create()
  // ========================================================================
  describe("create", () => {
    it("should create a key with dbackup_ prefix and return raw key once", async () => {
      const input: CreateApiKeyInput = {
        name: "CI Pipeline",
        permissions: ["jobs:execute", "history:read"],
        userId: "user-1",
        expiresAt: null,
      };

      prismaMock.apiKey.create.mockResolvedValue({
        id: "key-1",
        name: "CI Pipeline",
        prefix: "dbackup_abcdef12",
        hashedKey: "sha256hash",
        permissions: '["jobs:execute","history:read"]',
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: null,
        enabled: true,
        createdAt: new Date("2026-01-01"),
      } as any);

      const result = await service.create(input);

      // Raw key starts with prefix (30 bytes = 60 hex chars)
      expect(result.rawKey).toMatch(/^dbackup_[a-f0-9]{60}$/);
      // API key object is properly mapped
      expect(result.apiKey.id).toBe("key-1");
      expect(result.apiKey.name).toBe("CI Pipeline");
      expect(result.apiKey.permissions).toEqual(["jobs:execute", "history:read"]);
      expect(result.apiKey.enabled).toBe(true);

      // Prisma was called with hashed key (not raw)
      expect(prismaMock.apiKey.create).toHaveBeenCalledTimes(1);
      const createCall = prismaMock.apiKey.create.mock.calls[0][0];
      expect(createCall.data.name).toBe("CI Pipeline");
      expect(createCall.data.hashedKey).not.toContain("dbackup_");
      expect(createCall.data.hashedKey).toHaveLength(64); // scrypt 32-byte hex
      expect(createCall.data.prefix).toMatch(/^dbackup_/);
      expect(createCall.data.permissions).toBe('["jobs:execute","history:read"]');
    });

    it("should store optional expiresAt date", async () => {
      const expires = new Date("2026-12-31");
      const input: CreateApiKeyInput = {
        name: "Temp Key",
        permissions: ["jobs:read"],
        userId: "user-1",
        expiresAt: expires,
      };

      prismaMock.apiKey.create.mockResolvedValue({
        id: "key-2",
        name: "Temp Key",
        prefix: "dbackup_00000000",
        hashedKey: "hash",
        permissions: '["jobs:read"]',
        userId: "user-1",
        user: mockUser,
        expiresAt: expires,
        lastUsedAt: null,
        enabled: true,
        createdAt: new Date(),
      } as any);

      const result = await service.create(input);

      expect(result.apiKey.expiresAt).toEqual(expires);
      expect(prismaMock.apiKey.create.mock.calls[0][0].data.expiresAt).toEqual(expires);
    });

    it("should generate unique keys on each call", async () => {
      prismaMock.apiKey.create.mockResolvedValue({
        id: "key-1",
        name: "K1",
        prefix: "dbackup_00000000",
        hashedKey: "h1",
        permissions: "[]",
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: null,
        enabled: true,
        createdAt: new Date(),
      } as any);

      const r1 = await service.create({ name: "K1", permissions: [], userId: "user-1" });
      const r2 = await service.create({ name: "K2", permissions: [], userId: "user-1" });

      expect(r1.rawKey).not.toBe(r2.rawKey);
    });
  });

  // ========================================================================
  // list()
  // ========================================================================
  describe("list", () => {
    it("should return all keys ordered by creation date", async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([
        {
          id: "key-1",
          name: "Key A",
          prefix: "dbackup_aaaaaaaa",
          permissions: '["jobs:read"]',
          userId: "user-1",
          user: mockUser,
          expiresAt: null,
          lastUsedAt: null,
          enabled: true,
          createdAt: new Date("2026-02-01"),
        },
        {
          id: "key-2",
          name: "Key B",
          prefix: "dbackup_bbbbbbbb",
          permissions: '["jobs:read","jobs:write"]',
          userId: "user-1",
          user: mockUser,
          expiresAt: null,
          lastUsedAt: null,
          enabled: false,
          createdAt: new Date("2026-01-01"),
        },
      ] as any);

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Key A");
      expect(result[0].permissions).toEqual(["jobs:read"]);
      expect(result[1].permissions).toEqual(["jobs:read", "jobs:write"]);
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        })
      );
    });

    it("should filter by userId when provided", async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([]);

      await service.list("user-42");

      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-42" },
        })
      );
    });

    it("should not filter when no userId provided", async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([]);

      await service.list();

      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        })
      );
    });
  });

  // ========================================================================
  // getById()
  // ========================================================================
  describe("getById", () => {
    it("should return the API key by ID", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        name: "My Key",
        prefix: "dbackup_abcdef12",
        permissions: '["storage:read"]',
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: new Date("2026-02-15"),
        enabled: true,
        createdAt: new Date("2026-01-01"),
      } as any);

      const result = await service.getById("key-1");

      expect(result.id).toBe("key-1");
      expect(result.name).toBe("My Key");
      expect(result.permissions).toEqual(["storage:read"]);
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.getById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ========================================================================
  // delete()
  // ========================================================================
  describe("delete", () => {
    it("should delete an existing key", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1" } as any);
      prismaMock.apiKey.delete.mockResolvedValue({} as any);

      await service.delete("key-1");

      expect(prismaMock.apiKey.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.delete("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ========================================================================
  // toggle()
  // ========================================================================
  describe("toggle", () => {
    it("should enable a disabled key", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1", enabled: false } as any);
      prismaMock.apiKey.update.mockResolvedValue({
        id: "key-1",
        name: "Key",
        prefix: "dbackup_aaaaaaaa",
        permissions: "[]",
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: null,
        enabled: true,
        createdAt: new Date(),
      } as any);

      const result = await service.toggle("key-1", true);

      expect(result.enabled).toBe(true);
      expect(prismaMock.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { enabled: true },
        })
      );
    });

    it("should disable an enabled key", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1", enabled: true } as any);
      prismaMock.apiKey.update.mockResolvedValue({
        id: "key-1",
        name: "Key",
        prefix: "dbackup_aaaaaaaa",
        permissions: "[]",
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: null,
        enabled: false,
        createdAt: new Date(),
      } as any);

      const result = await service.toggle("key-1", false);

      expect(result.enabled).toBe(false);
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.toggle("nonexistent", true)).rejects.toThrow(NotFoundError);
    });
  });

  // ========================================================================
  // rotate()
  // ========================================================================
  describe("rotate", () => {
    it("should generate a new key and replace the hash", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        hashedKey: "old-hash",
      } as any);

      prismaMock.apiKey.update.mockResolvedValue({
        id: "key-1",
        name: "Rotated Key",
        prefix: "dbackup_newpre",
        permissions: '["jobs:execute"]',
        userId: "user-1",
        user: mockUser,
        expiresAt: null,
        lastUsedAt: null,
        enabled: true,
        createdAt: new Date(),
      } as any);

      const result = await service.rotate("key-1");

      // New raw key is returned (30 bytes = 60 hex chars)
      expect(result.rawKey).toMatch(/^dbackup_[a-f0-9]{60}$/);
      expect(result.apiKey.id).toBe("key-1");

      // Prisma update was called with new hash
      const updateCall = prismaMock.apiKey.update.mock.calls[0][0];
      expect(updateCall.data.hashedKey).not.toBe("old-hash");
      expect(updateCall.data.hashedKey).toHaveLength(64); // scrypt 32-byte hex
      expect(updateCall.data.prefix).toMatch(/^dbackup_[a-f0-9]{8}$/);
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.rotate("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ========================================================================
  // update()
  // ========================================================================
  describe("update", () => {
    it("should save the name, the permissions and the end, and say what they were", async () => {
      const before = new Date("2026-12-01");
      const after = new Date("2027-03-01");
      prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1", name: "Old", permissions: '["jobs:read"]', expiresAt: before } as any);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.update("key-1", { name: "New", permissions: ["jobs:read", "jobs:execute"] as any, expiresAt: after });

      expect(prismaMock.apiKey.update).toHaveBeenCalledWith({
        where: { id: "key-1" },
        data: { name: "New", permissions: '["jobs:read","jobs:execute"]', expiresAt: after },
      });
      expect(result.before).toEqual({ name: "Old", permissions: ["jobs:read"], expiresAt: before });
    });

    it("should keep the secret", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1", name: "Key", permissions: "[]", expiresAt: null } as any);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      await service.update("key-1", { name: "Key", permissions: [], expiresAt: null });

      const data = prismaMock.apiKey.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("hashedKey");
      expect(data).not.toHaveProperty("prefix");
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.update("nonexistent", { name: "Key", permissions: [], expiresAt: null })).rejects.toThrow(NotFoundError);
    });
  });

  // ========================================================================
  // ownerOf() and nameTaken()
  // ========================================================================
  describe("ownerOf", () => {
    it("should return the owner with the group and what the key holds", async () => {
      const group = { name: "Operators", permissions: '["jobs:read"]' };
      prismaMock.apiKey.findUnique.mockResolvedValue({ userId: "user-1", name: "Key", permissions: '["jobs:read","users:write"]', user: { group } } as any);

      await expect(service.ownerOf("key-1")).resolves.toEqual({ ownerId: "user-1", name: "Key", permissions: ["jobs:read", "users:write"], group });
    });

    it("should throw NotFoundError if key does not exist", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.ownerOf("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("nameTaken", () => {
    it("should find another key by its name in any case", async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([{ name: "CI pipeline" }] as any);

      await expect(service.nameTaken("ci Pipeline ")).resolves.toBe(true);
      await expect(service.nameTaken("Monitoring")).resolves.toBe(false);
    });

    it("should leave out the key being renamed", async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([] as any);

      await service.nameTaken("CI pipeline", "key-1");

      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { not: "key-1" } } }));
    });
  });

  // ========================================================================
  // validate()
  // ========================================================================
  describe("validate", () => {
    it("should return null for key without dbackup_ prefix", async () => {
      const result = await service.validate("invalid_key_without_prefix");

      expect(result).toBeNull();
      expect(prismaMock.apiKey.findUnique).not.toHaveBeenCalled();
    });

    it("should return null for key not found in database", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      const result = await service.validate("dbackup_" + "a".repeat(40));

      expect(result).toBeNull();
    });

    it("should return validated key for valid, enabled, non-expired key", async () => {
      const futureDate = new Date("2099-12-31");

      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["jobs:execute","history:read"]',
        enabled: true,
        user: owner,
        expiresAt: futureDate,
      } as any);

      // Mock the fire-and-forget lastUsedAt update
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate("dbackup_" + "b".repeat(40));

      expect(result).toEqual({
        id: "key-1",
        userId: "user-1",
        permissions: ["jobs:execute", "history:read"],
      });
    });

    it("should return validated key when expiresAt is null (no expiration)", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-2",
        userId: "user-1",
        permissions: '["jobs:read"]',
        enabled: true,
        user: owner,
        expiresAt: null,
      } as any);

      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate("dbackup_" + "c".repeat(40));

      expect(result).toEqual({
        id: "key-2",
        userId: "user-1",
        permissions: ["jobs:read"],
      });
    });

    it("should throw ApiKeyError for disabled key", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: "[]",
        enabled: false,
        expiresAt: null,
      } as any);

      await expect(service.validate("dbackup_" + "d".repeat(40))).rejects.toThrow(ApiKeyError);
    });

    it("should throw ApiKeyError for expired key", async () => {
      const pastDate = new Date("2020-01-01");

      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: "[]",
        enabled: true,
        expiresAt: pastDate,
      } as any);

      await expect(service.validate("dbackup_" + "e".repeat(40))).rejects.toThrow(ApiKeyError);
    });

    it("should look up by scrypt hash of the raw key", async () => {
      const rawKey = "dbackup_" + "f".repeat(40);
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await service.validate(rawKey);

      // The where clause should use hashedKey, not the raw key
      const findCall = prismaMock.apiKey.findUnique.mock.calls[0][0];
      expect(findCall.where.hashedKey).toBeDefined();
      expect(findCall.where.hashedKey).not.toContain("dbackup_");
      expect(findCall.where.hashedKey).toHaveLength(64); // scrypt 32-byte hex
    });

    it("should use scrypt hash, not plain SHA-256", async () => {
      const rawKey = "dbackup_" + "a".repeat(60);
      const sha256Hash = createHash("sha256").update(rawKey).digest("hex");

      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      await service.validate(rawKey);

      // First lookup uses scrypt, which must differ from plain SHA-256
      const findCall = prismaMock.apiKey.findUnique.mock.calls[0][0];
      expect(findCall.where.hashedKey).not.toBe(sha256Hash);
    });

    it("should produce deterministic scrypt hashes for the same key", async () => {
      const rawKey = "dbackup_" + "b".repeat(60);

      prismaMock.apiKey.findUnique.mockResolvedValue(null);
      await service.validate(rawKey);
      const hash1 = prismaMock.apiKey.findUnique.mock.calls[0][0].where.hashedKey;

      prismaMock.apiKey.findUnique.mockClear();
      prismaMock.apiKey.findUnique.mockResolvedValue(null);
      await service.validate(rawKey);
      const hash2 = prismaMock.apiKey.findUnique.mock.calls[0][0].where.hashedKey;

      expect(hash1).toBe(hash2);
    });

    it("should migrate legacy SHA-256 key to scrypt on validation", async () => {
      const rawKey = "dbackup_" + "c".repeat(60);
      const legacySha256 = createHash("sha256").update(rawKey).digest("hex");
      const expectedScrypt = scryptSync(
        rawKey,
        "dbackup-api-key-scrypt-v1",
        32,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      ).toString("hex");

      // First call (scrypt lookup) returns null, second call (legacy SHA-256) finds the key
      prismaMock.apiKey.findUnique
        .mockResolvedValueOnce(null) // scrypt lookup miss
        .mockResolvedValueOnce({
          id: "key-legacy",
          userId: "user-1",
          permissions: '["jobs:read"]',
          enabled: true,
          user: owner,
        expiresAt: null,
        } as any);

      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate(rawKey);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("key-legacy");

      // Second findUnique call should use legacy SHA-256 hash
      const legacyLookup = prismaMock.apiKey.findUnique.mock.calls[1][0];
      expect(legacyLookup.where.hashedKey).toBe(legacySha256);

      // Update call should migrate to scrypt
      const updateCall = prismaMock.apiKey.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe("key-legacy");
      expect(updateCall.data.hashedKey).toBe(expectedScrypt);
      expect(updateCall.data.hashedKey).not.toBe(legacySha256);
    });

    it("should fire-and-forget update lastUsedAt on success", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["jobs:read"]',
        enabled: true,
        user: owner,
        expiresAt: null,
      } as any);

      prismaMock.apiKey.update.mockResolvedValue({} as any);

      await service.validate("dbackup_" + "a".repeat(40));

      // lastUsedAt update should have been called (fire-and-forget)
      expect(prismaMock.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "key-1" },
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        })
      );
    });

    it("should not migrate when scrypt hash is already found", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["jobs:read"]',
        enabled: true,
        user: owner,
        expiresAt: null,
      } as any);

      prismaMock.apiKey.update.mockResolvedValue({} as any);

      await service.validate("dbackup_" + "d".repeat(60));

      // Only one findUnique call (scrypt hit), no migration update for hashedKey
      expect(prismaMock.apiKey.findUnique).toHaveBeenCalledTimes(1);
      // The only update should be for lastUsedAt, not hashedKey
      if (prismaMock.apiKey.update.mock.calls.length > 0) {
        const updateData = prismaMock.apiKey.update.mock.calls[0][0].data;
        expect(updateData).not.toHaveProperty("hashedKey");
      }
    });

    it("should never give a key more than the group of its owner may do", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["jobs:execute","users:write","groups:write"]',
        enabled: true,
        user: { group: { name: "Operators", permissions: '["jobs:execute","jobs:read"]' } },
        expiresAt: null,
      } as any);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate("dbackup_" + "a".repeat(60));

      expect(result!.permissions).toEqual(["jobs:execute"]);
    });

    it("should let a key of a SuperAdmin keep what it holds", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["users:write","settings:write"]',
        enabled: true,
        user: { group: { name: "SuperAdmin", permissions: "[]" } },
        expiresAt: null,
      } as any);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate("dbackup_" + "a".repeat(60));

      expect(result!.permissions).toEqual(["users:write", "settings:write"]);
    });

    it("should leave a key of an owner without a group nothing", async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: '["jobs:read"]',
        enabled: true,
        user: { group: null },
        expiresAt: null,
      } as any);
      prismaMock.apiKey.update.mockResolvedValue({} as any);

      const result = await service.validate("dbackup_" + "a".repeat(60));

      expect(result!.permissions).toEqual([]);
    });
  });
});
