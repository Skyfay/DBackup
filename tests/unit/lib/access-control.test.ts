import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthContext, checkAnyPermissionWithContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PermissionError, ApiKeyError, AuthenticationError } from "@/lib/logging/errors";
import { PERMISSIONS, AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";

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

// Mock auth
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

// Mock prisma
const mockPrismaUser = {
  findUnique: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
};
const mockPrismaGroup = {
  upsert: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: any[]) => mockPrismaUser.findUnique(...args),
      count: (...args: any[]) => mockPrismaUser.count(...args),
      update: (...args: any[]) => mockPrismaUser.update(...args),
    },
    group: {
      upsert: (...args: any[]) => mockPrismaGroup.upsert(...args),
    },
  },
}));

// Mock apiKeyService
const mockValidate = vi.fn();
vi.mock("@/services/auth/api-key-service", () => ({
  apiKeyService: {
    validate: (...args: any[]) => mockValidate(...args),
  },
}));

// Import functions after mocks are defined
const {
  getAuthContext,
  getCurrentUserWithGroup,
  checkPermission,
  getUserPermissions,
  hasPermission,
} = await import("@/lib/auth/access-control");

describe("Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // getAuthContext()
  // ========================================================================
  describe("getAuthContext", () => {
    it("should return session-based context for authenticated user with group", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        group: {
          name: "Operators",
          permissions: '["jobs:read","jobs:execute","history:read"]',
        },
      });

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe("user-1");
      expect(ctx!.authMethod).toBe("session");
      expect(ctx!.isSuperAdmin).toBe(false);
      expect(ctx!.permissions).toEqual(["jobs:read", "jobs:execute", "history:read"]);
      expect(ctx!.apiKeyId).toBeUndefined();
    });

    it("should grant all permissions to SuperAdmin session", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "admin-1" },
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "admin-1",
        group: {
          name: "SuperAdmin",
          permissions: "[]", // doesn't matter for SuperAdmin
        },
      });

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.isSuperAdmin).toBe(true);
      expect(ctx!.authMethod).toBe("session");
      // SuperAdmin gets all available permissions
      expect(ctx!.permissions.length).toBe(AVAILABLE_PERMISSIONS.length);
    });

    it("should fall back to API key when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: ["jobs:execute", "history:read"],
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_testkey123",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe("user-1");
      expect(ctx!.authMethod).toBe("apikey");
      expect(ctx!.apiKeyId).toBe("key-1");
      expect(ctx!.isSuperAdmin).toBe(false);
      expect(ctx!.permissions).toEqual(["jobs:execute", "history:read"]);
    });

    it("should never grant SuperAdmin to API key auth", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "admin-1",
        permissions: ["jobs:execute"],
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_superadminkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.isSuperAdmin).toBe(false);
    });

    it("should return null when no session and no Bearer token", async () => {
      mockGetSession.mockResolvedValue(null);

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx).toBeNull();
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("should return null when no session and invalid API key", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue(null);

      const headers = new Headers({
        authorization: "Bearer dbackup_invalidkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx).toBeNull();
    });

    it("should rethrow ApiKeyError for disabled keys", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockRejectedValue(new ApiKeyError("disabled", "API key is disabled"));

      const headers = new Headers({
        authorization: "Bearer dbackup_disabledkey",
      });

      await expect(getAuthContext(headers)).rejects.toThrow(ApiKeyError);
    });

    it("should rethrow ApiKeyError for expired keys", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockRejectedValue(new ApiKeyError("expired", "API key has expired"));

      const headers = new Headers({
        authorization: "Bearer dbackup_expiredkey",
      });

      await expect(getAuthContext(headers)).rejects.toThrow(ApiKeyError);
    });

    it("should prefer session over API key when both are present", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "session-user" },
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "session-user",
        group: {
          name: "Editors",
          permissions: '["jobs:read"]',
        },
      });

      // Both session and API key present - session should win
      const headers = new Headers({
        authorization: "Bearer dbackup_somekey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.authMethod).toBe("session");
      expect(ctx!.userId).toBe("session-user");
      // API key validate should NOT be called
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("should fall back to API key when session check throws", async () => {
      mockGetSession.mockRejectedValue(new Error("Session error"));
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: ["jobs:read"],
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_fallbackkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.authMethod).toBe("apikey");
    });

    it("should fall back to API key when session user has no group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      // User exists but has no group assigned.
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        group: null,
      });
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: ["jobs:read"],
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_fallbackkey",
      });
      const ctx = await getAuthContext(headers);

      // Session auth was incomplete (no group), so API key auth takes over.
      expect(ctx!.authMethod).toBe("apikey");
    });

    it("should ignore non-Bearer authorization headers", async () => {
      mockGetSession.mockResolvedValue(null);

      const headers = new Headers({
        authorization: "Basic dXNlcjpwYXNz",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx).toBeNull();
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("should handle empty group permissions gracefully", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        group: {
          name: "Empty Group",
          permissions: "invalid-json",
        },
      });

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx!.permissions).toEqual([]);
    });
  });

  // ========================================================================
  // checkPermissionWithContext()
  // ========================================================================
  describe("checkPermissionWithContext", () => {
    it("should allow access when permission is present", () => {
      const ctx: AuthContext = {
        userId: "user-1",
        permissions: ["jobs:read", "jobs:execute", "history:read"],
        isSuperAdmin: false,
        authMethod: "apikey",
      };

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);
      }).not.toThrow();
    });

    it("should throw PermissionError when permission is missing", () => {
      const ctx: AuthContext = {
        userId: "user-1",
        permissions: ["jobs:read"],
        isSuperAdmin: false,
        authMethod: "apikey",
      };

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);
      }).toThrow(PermissionError);
    });

    it("should bypass permission check for SuperAdmin sessions", () => {
      const ctx: AuthContext = {
        userId: "admin-1",
        permissions: [], // empty, but SuperAdmin bypasses
        isSuperAdmin: true,
        authMethod: "session",
      };

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);
      }).not.toThrow();
    });

    it("should NOT bypass for API key even with isSuperAdmin false", () => {
      const ctx: AuthContext = {
        userId: "user-1",
        permissions: [],
        isSuperAdmin: false,
        authMethod: "apikey",
        apiKeyId: "key-1",
      };

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
      }).toThrow(PermissionError);
    });

    it("should check exact permission string match", () => {
      const ctx: AuthContext = {
        userId: "user-1",
        permissions: ["jobs:read"],
        isSuperAdmin: false,
        authMethod: "session",
      };

      // jobs:read does NOT grant jobs:write
      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);
      }).toThrow(PermissionError);
    });
  });

  // ========================================================================
  // getCurrentUserWithGroup()
  // ========================================================================
  describe("checkAnyPermissionWithContext", () => {
    const readOnly = [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD] as const;
    const ctxWith = (permissions: string[], isSuperAdmin = false): AuthContext => ({
      userId: "user-1",
      permissions,
      isSuperAdmin,
      authMethod: "apikey",
    });

    it("lets a download-only integration read a backup's contents", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.DOWNLOAD]), readOnly)).not.toThrow();
    });

    it("lets a restore-only user read a backup's contents", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.RESTORE]), readOnly)).not.toThrow();
    });

    it("refuses a user holding neither, naming both", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.READ]), readOnly))
        .toThrow(new PermissionError(`${PERMISSIONS.STORAGE.RESTORE} or ${PERMISSIONS.STORAGE.DOWNLOAD}`));
    });

    it("lets a SuperAdmin session through", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([], true), readOnly)).not.toThrow();
    });
  });

  describe("getCurrentUserWithGroup", () => {
    it("should return null when session throws", async () => {
      mockGetSession.mockRejectedValue(new Error("headers unavailable"));

      const result = await getCurrentUserWithGroup();

      expect(result).toBeNull();
    });

    it("should return null when no session user", async () => {
      mockGetSession.mockResolvedValue(null);

      const result = await getCurrentUserWithGroup();

      expect(result).toBeNull();
    });

    it("should return user with group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "Editors", permissions: '["jobs:read"]' },
      });

      const result = await getCurrentUserWithGroup();

      expect(result).not.toBeNull();
      expect(result!.id).toBe("user-1");
      expect(result!.group!.name).toBe("Editors");
    });

    it("should auto-promote single user to SuperAdmin when no group is assigned", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: null,
        group: null,
      });
      mockPrismaUser.count.mockResolvedValue(1);
      mockPrismaGroup.upsert.mockResolvedValue({ id: "g-1", name: "SuperAdmin" });
      mockPrismaUser.update.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "SuperAdmin", permissions: "[]" },
      });

      const result = await getCurrentUserWithGroup();

      expect(result!.group!.name).toBe("SuperAdmin");
      expect(mockPrismaGroup.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: "SuperAdmin" } }),
      );
    });

    it("should not auto-promote when multiple users exist", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: null,
        group: null,
      });
      mockPrismaUser.count.mockResolvedValue(3);

      const result = await getCurrentUserWithGroup();

      expect(mockPrismaGroup.upsert).not.toHaveBeenCalled();
      expect(result!.groupId).toBeNull();
    });
  });

  // ========================================================================
  // checkPermission()
  // ========================================================================
  describe("checkPermission", () => {
    it("should throw AuthenticationError when no user is found", async () => {
      mockGetSession.mockResolvedValue(null);

      await expect(checkPermission(PERMISSIONS.JOBS.READ)).rejects.toThrow(AuthenticationError);
    });

    it("should throw PermissionError when user has no group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: null,
        group: null,
      });
      mockPrismaUser.count.mockResolvedValue(2); // no auto-promote

      await expect(checkPermission(PERMISSIONS.JOBS.READ)).rejects.toThrow(PermissionError);
    });

    it("should return user for SuperAdmin regardless of permission", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "admin-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "admin-1",
        groupId: "g-admin",
        group: { name: "SuperAdmin", permissions: "[]" },
      });

      const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

      expect(user.id).toBe("admin-1");
    });

    it("should return user when permission is present in group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "Operators", permissions: '["jobs:read","jobs:execute"]' },
      });

      const user = await checkPermission(PERMISSIONS.JOBS.EXECUTE);

      expect(user.id).toBe("user-1");
    });

    it("should throw PermissionError when permission is missing from group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "ReadOnly", permissions: '["jobs:read"]' },
      });

      await expect(checkPermission(PERMISSIONS.JOBS.EXECUTE)).rejects.toThrow(PermissionError);
    });

    it("should throw PermissionError when group permissions JSON is invalid", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { id: "g-1", name: "Broken", permissions: "not-valid-json" },
      });

      await expect(checkPermission(PERMISSIONS.JOBS.READ)).rejects.toThrow(PermissionError);
    });
  });

  // ========================================================================
  // getUserPermissions()
  // ========================================================================
  describe("getUserPermissions", () => {
    it("should return empty array when no user session", async () => {
      mockGetSession.mockResolvedValue(null);

      const perms = await getUserPermissions();

      expect(perms).toEqual([]);
    });

    it("should return empty array when user has no group", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: null,
        group: null,
      });
      mockPrismaUser.count.mockResolvedValue(2);

      const perms = await getUserPermissions();

      expect(perms).toEqual([]);
    });

    it("should return all available permissions for SuperAdmin", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "admin-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "admin-1",
        groupId: "g-admin",
        group: { name: "SuperAdmin", permissions: "[]" },
      });

      const perms = await getUserPermissions();

      expect(perms.length).toBe(AVAILABLE_PERMISSIONS.length);
      expect(perms).toContain(PERMISSIONS.SETTINGS.WRITE);
    });

    it("should return parsed permissions for regular user", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "Editors", permissions: '["jobs:read","history:read"]' },
      });

      const perms = await getUserPermissions();

      expect(perms).toEqual(["jobs:read", "history:read"]);
    });

    it("should return empty array when permissions JSON is invalid", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "Broken", permissions: "{invalid" },
      });

      const perms = await getUserPermissions();

      expect(perms).toEqual([]);
    });
  });

  // ========================================================================
  // hasPermission()
  // ========================================================================
  describe("hasPermission", () => {
    it("should return true when user has the permission", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "Operators", permissions: '["jobs:execute"]' },
      });

      const result = await hasPermission(PERMISSIONS.JOBS.EXECUTE);

      expect(result).toBe(true);
    });

    it("should return false when user lacks the permission", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockPrismaUser.findUnique.mockResolvedValue({
        id: "user-1",
        groupId: "g-1",
        group: { name: "ReadOnly", permissions: '["jobs:read"]' },
      });

      const result = await hasPermission(PERMISSIONS.JOBS.EXECUTE);

      expect(result).toBe(false);
    });

    it("should return false when no user session exists", async () => {
      mockGetSession.mockResolvedValue(null);

      const result = await hasPermission(PERMISSIONS.JOBS.READ);

      expect(result).toBe(false);
    });
  });
});
