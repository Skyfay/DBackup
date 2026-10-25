import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_TENANTS_REFUSAL, AuthContext, checkAnyPermissionWithContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PermissionError, ApiKeyError, AuthenticationError } from "@/lib/logging/errors";
import { PERMISSIONS, AVAILABLE_PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { PlatformGroupGrant } from "@/lib/auth/owner-permissions";

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

// Every call hands out new headers, as every request does, so no context is kept between tests.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

// Mock prisma
const mockPrismaUser = {
  findUnique: vi.fn(),
  count: vi.fn(),
};
const mockPrismaTenant = { findUnique: vi.fn(), count: vi.fn() };
const mockPrismaMembership = { findUnique: vi.fn() };
// What the promotion of the first account writes, inside its transaction.
const mockTx = {
  user: { update: vi.fn() },
  tenantMembership: { upsert: vi.fn() },
};
// The full access group the first account gets, found or made by the group service.
const mockEnsureFullAccessGroup = vi.fn();
vi.mock("@/services/user/group-service", () => ({
  ensureFullAccessGroup: (...args: any[]) => mockEnsureFullAccessGroup(...args),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: any[]) => mockPrismaUser.findUnique(...args),
      count: (...args: any[]) => mockPrismaUser.count(...args),
    },
    tenant: {
      findUnique: (...args: any[]) => mockPrismaTenant.findUnique(...args),
      count: (...args: any[]) => mockPrismaTenant.count(...args),
    },
    tenantMembership: {
      findUnique: (...args: any[]) => mockPrismaMembership.findUnique(...args),
    },
    $transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
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
  getViewer,
  checkPermission,
  getUserPermissions,
  hasPermission,
} = await import("@/lib/auth/access-control");

interface Membership {
  tenantId?: string;
  permissions: string;
  fullAccess?: boolean;
}

/** An account as `getAuthContext` and `getViewer` read it, with its roles per tenant. */
function account(id: string, options: { platformRole?: string | null; memberships?: Membership[]; platformGroup?: PlatformGroupGrant | null } = {}) {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    platformRole: options.platformRole ?? null,
    platformGroup: options.platformGroup ?? null,
    memberships: (options.memberships ?? []).map((membership) => ({
      tenantId: membership.tenantId ?? HOME_TENANT_ID,
      group: { permissions: membership.permissions, fullAccess: membership.fullAccess ?? false },
    })),
  };
}

function signedIn(row: ReturnType<typeof account>, activeTenantId?: string) {
  mockGetSession.mockResolvedValue({ user: { id: row.id }, session: { id: "session-1", activeTenantId } });
  mockPrismaUser.findUnique.mockResolvedValue(row);
}

const ctxOf = (overrides: Partial<AuthContext>): AuthContext => ({
  userId: "user-1",
  permissions: [],
  isPlatformAdmin: false,
  authMethod: "apikey",
  tenantId: HOME_TENANT_ID,
  allTenants: false,
  ...overrides,
});

describe("Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaUser.findUnique.mockReset();
    mockPrismaTenant.findUnique.mockResolvedValue(null);
    // One tenant, as every installation starts.
    mockPrismaTenant.count.mockResolvedValue(1);
    mockPrismaMembership.findUnique.mockResolvedValue(null);
  });

  // ========================================================================
  // getAuthContext()
  // ========================================================================
  describe("getAuthContext", () => {
    it("should return session-based context for authenticated user with group", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read","jobs:execute","history:read"]' }] }));

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe("user-1");
      expect(ctx!.authMethod).toBe("session");
      expect(ctx!.isPlatformAdmin).toBe(false);
      expect(ctx!.tenantId).toBe(HOME_TENANT_ID);
      expect(ctx!.permissions).toEqual(["jobs:read", "jobs:execute", "history:read"]);
      expect(ctx!.apiKeyId).toBeUndefined();
    });

    it("should grant all permissions to a platform admin session", async () => {
      // A platform admin needs no role anywhere.
      signedIn(account("admin-1", { platformRole: "ADMIN" }));

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.isPlatformAdmin).toBe(true);
      expect(ctx!.authMethod).toBe("session");
      expect(ctx!.tenantId).toBe(HOME_TENANT_ID);
      // A platform admin gets all available permissions
      // Changing the sign-in providers is one more, no group gives it.
      expect(ctx!.permissions.length).toBe(AVAILABLE_PERMISSIONS.length + PLATFORM_ONLY_PERMISSIONS.length + 1);
      expect(ctx!.permissions).toContain(PERMISSIONS.PLATFORM.SIGN_IN_WRITE);
    });

    it("gives the full access role every permission, whatever its stored list says", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: "[]", fullAccess: true }] }));

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.isPlatformAdmin).toBe(false);
      // Every permission of a tenant, none of the platform, which only a platform group gives.
      expect(ctx!.permissions.length).toBe(AVAILABLE_PERMISSIONS.length);
    });

    it("should fall back to API key when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        permissions: ["jobs:execute", "history:read"],
        tenantId: "tenant-a",
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_testkey123",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe("user-1");
      expect(ctx!.authMethod).toBe("apikey");
      expect(ctx!.apiKeyId).toBe("key-1");
      expect(ctx!.isPlatformAdmin).toBe(false);
      expect(ctx!.permissions).toEqual(["jobs:execute", "history:read"]);
      // A key acts in the tenant it was made in.
      expect(ctx!.tenantId).toBe("tenant-a");
    });

    it("should never make an API key act as a platform admin", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "admin-1",
        permissions: ["jobs:execute"],
        tenantId: HOME_TENANT_ID,
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_superadminkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.isPlatformAdmin).toBe(false);
      expect(ctx!.permissions).toEqual(["jobs:execute"]);
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
      signedIn(account("session-user", { memberships: [{ permissions: '["jobs:read"]' }] }));

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
        tenantId: HOME_TENANT_ID,
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_fallbackkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.authMethod).toBe("apikey");
    });

    it("should fall back to API key when the account of the session no longer exists", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1" } });
      mockPrismaUser.findUnique.mockResolvedValue(null);
      mockValidate.mockResolvedValue({
        id: "key-1",
        userId: "user-2",
        permissions: ["jobs:read"],
        tenantId: HOME_TENANT_ID,
      });

      const headers = new Headers({
        authorization: "Bearer dbackup_fallbackkey",
      });
      const ctx = await getAuthContext(headers);

      expect(ctx!.authMethod).toBe("apikey");
      expect(ctx!.userId).toBe("user-2");
    });

    it("gives a session of an account without a tenant nothing and no tenant", async () => {
      signedIn(account("user-1"));
      mockPrismaUser.count.mockResolvedValue(2); // not the first account, so no promotion

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.authMethod).toBe("session");
      expect(ctx!.isPlatformAdmin).toBe(false);
      expect(ctx!.tenantId).toBeNull();
      expect(ctx!.permissions).toEqual([]);
      expect(mockTx.user.update).not.toHaveBeenCalled();
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
      signedIn(account("user-1", { memberships: [{ permissions: "invalid-json" }] }));

      const headers = new Headers();
      const ctx = await getAuthContext(headers);

      expect(ctx!.permissions).toEqual([]);
    });

    it("reads the context of a request once, however often it is asked", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read"]' }] }));
      const headers = new Headers();

      const first = await getAuthContext(headers);
      const second = await getAuthContext(headers);

      expect(second).toBe(first);
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // The tenant of a session
  // ========================================================================
  describe("the tenant a session works in", () => {
    it("works in the tenant the session picked, with the role there", async () => {
      signedIn(account("user-1", {
        memberships: [
          { tenantId: HOME_TENANT_ID, permissions: '["history:read"]' },
          { tenantId: "tenant-a", permissions: '["jobs:read","jobs:execute"]' },
        ],
      }), "tenant-a");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.tenantId).toBe("tenant-a");
      expect(ctx!.permissions).toEqual(["jobs:read", "jobs:execute"]);
    });

    it("never lets a session work in a tenant its account is no member of", async () => {
      signedIn(account("user-1", { memberships: [{ tenantId: "tenant-a", permissions: '["jobs:read"]' }] }), "tenant-b");
      // The tenant exists, which only a platform admin may pick without a membership.
      mockPrismaTenant.findUnique.mockResolvedValue({ id: "tenant-b" });

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.tenantId).toBe("tenant-a");
      expect(ctx!.permissions).toEqual(["jobs:read"]);
    });

    it("lets a platform admin pick any tenant that exists", async () => {
      signedIn(account("admin-1", { platformRole: "ADMIN" }), "tenant-b");
      mockPrismaTenant.findUnique.mockResolvedValue({ id: "tenant-b" });

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.tenantId).toBe("tenant-b");
      expect(ctx!.isPlatformAdmin).toBe(true);
    });

    it("starts a platform admin in All tenants once there are several, which reads every tenant and changes none", async () => {
      mockPrismaTenant.count.mockResolvedValue(3);
      signedIn(account("admin-1", { platformRole: "ADMIN" }));

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.allTenants).toBe(true);
      expect(ctx!.tenantId).toBeNull();
      expect(ctx!.permissions).toContain(PERMISSIONS.JOBS.READ);
      expect(ctx!.permissions).toContain(PERMISSIONS.SETTINGS.WRITE);
      expect(ctx!.permissions).not.toContain(PERMISSIONS.JOBS.EXECUTE);
      expect(() => checkPermissionWithContext(ctx!, PERMISSIONS.SOURCES.WRITE)).toThrow(PermissionError);
      expect(() => checkPermissionWithContext(ctx!, PERMISSIONS.STORAGE.READ)).not.toThrow();
    });

    it("keeps a platform admin in the home tenant while it is the only one", async () => {
      signedIn(account("admin-1", { platformRole: "ADMIN" }), "*");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.allTenants).toBe(false);
      expect(ctx!.tenantId).toBe(HOME_TENANT_ID);
    });

    describe("a platform group of the MSP", () => {
      /** Support: runs jobs and restores in the tenants of its scope, and sees the tenants. */
      const support = (scope: { allTenants: boolean; tenants?: string[] }): PlatformGroupGrant => ({
        platformPermissions: JSON.stringify([PERMISSIONS.PLATFORM.TENANTS_READ]),
        tenantPermissions: JSON.stringify([PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.SETTINGS.WRITE]),
        allTenants: scope.allTenants,
        tenants: (scope.tenants ?? []).map((tenantId) => ({ tenantId })),
      });

      it("adds its rights in a tenant of its scope to the group someone holds there, never the settings of the instance", async () => {
        signedIn(account("lena", { memberships: [{ tenantId: "acme", permissions: JSON.stringify([PERMISSIONS.HISTORY.READ]) }], platformGroup: support({ allTenants: false, tenants: ["acme"] }) }), "acme");

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.tenantId).toBe("acme");
        expect(ctx!.permissions).toEqual(expect.arrayContaining([PERMISSIONS.HISTORY.READ, PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.PLATFORM.TENANTS_READ]));
        expect(ctx!.permissions).not.toContain(PERMISSIONS.SETTINGS.WRITE);
        expect(ctx!.isPlatformAdmin).toBe(false);
      });

      it("opens a tenant of its scope without a membership, and no tenant beyond it", async () => {
        mockPrismaTenant.findUnique.mockResolvedValue({ id: "globex" });
        signedIn(account("lena", { platformGroup: support({ allTenants: false, tenants: ["acme"] }) }), "globex");

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.tenantId).toBe("acme");
        expect(ctx!.permissions).toContain(PERMISSIONS.JOBS.EXECUTE);
      });

      it("opens All tenants when it reaches every tenant, with its reads and its rights on the platform only", async () => {
        mockPrismaTenant.count.mockResolvedValue(3);
        signedIn(account("lena", { platformGroup: support({ allTenants: true }) }));

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.allTenants).toBe(true);
        expect(ctx!.permissions).toEqual(expect.arrayContaining([PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.READ, PERMISSIONS.PLATFORM.TENANTS_READ]));
        expect(ctx!.permissions).not.toContain(PERMISSIONS.JOBS.EXECUTE);
        expect(ctx!.permissions).not.toContain(PERMISSIONS.PLATFORM.TENANTS_WRITE);
      });

      it("lets its people change their own profile, also without a group in any tenant", async () => {
        signedIn(account("lena", { platformGroup: support({ allTenants: false, tenants: ["acme"] }) }), "acme");

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.permissions).toContain(PERMISSIONS.PROFILE.UPDATE_PASSWORD);
      });

      it("never lets a platform group change the sign-in providers, which sign in as anyone of their emails", async () => {
        const group = support({ allTenants: true });
        group.platformPermissions = JSON.stringify([PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.PLATFORM.SIGN_IN_WRITE]);
        signedIn(account("lena", { platformGroup: group }), HOME_TENANT_ID);

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.permissions).toContain(PERMISSIONS.PLATFORM.SIGN_IN_READ);
        expect(ctx!.permissions).not.toContain(PERMISSIONS.PLATFORM.SIGN_IN_WRITE);
      });

      it("shares with customers only in a tenant of its scope, never in one where someone is merely a member", async () => {
        const sharing = support({ allTenants: false, tenants: ["acme"] });
        sharing.platformPermissions = JSON.stringify([PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE]);
        const lena = account("lena", { memberships: [{ tenantId: HOME_TENANT_ID, permissions: JSON.stringify([PERMISSIONS.SOURCES.READ]) }], platformGroup: sharing });

        signedIn(lena, HOME_TENANT_ID);
        const atHome = await getAuthContext(new Headers());
        expect(atHome!.tenantId).toBe(HOME_TENANT_ID);
        expect(atHome!.permissions).toContain(PERMISSIONS.PLATFORM.TENANTS_READ);
        expect(atHome!.permissions).not.toContain(PERMISSIONS.PLATFORM.SHARING_READ);
        expect(atHome!.permissions).not.toContain(PERMISSIONS.PLATFORM.SHARING_WRITE);

        mockPrismaTenant.findUnique.mockResolvedValue({ id: "acme" });
        signedIn(lena, "acme");
        const inScope = await getAuthContext(new Headers());
        expect(inScope!.tenantId).toBe("acme");
        expect(inScope!.permissions).toEqual(expect.arrayContaining([PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE]));
      });

      it("never opens All tenants for a group of some tenants, which would show the others too", async () => {
        mockPrismaTenant.count.mockResolvedValue(3);
        signedIn(account("lena", { platformGroup: support({ allTenants: false, tenants: ["acme"] }) }), "*");

        const ctx = await getAuthContext(new Headers());

        expect(ctx!.allTenants).toBe(false);
        expect(ctx!.tenantId).toBe("acme");
      });
    });

    it("never gives All tenants to anyone but a platform admin", async () => {
      mockPrismaTenant.count.mockResolvedValue(3);
      signedIn(account("user-1", { memberships: [{ tenantId: "tenant-a", permissions: '["jobs:read"]' }] }), "*");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.allTenants).toBe(false);
      expect(ctx!.tenantId).toBe("tenant-a");
    });

    it("sends a platform admin home when the picked tenant is gone", async () => {
      signedIn(account("admin-1", { platformRole: "ADMIN" }), "tenant-gone");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.tenantId).toBe(HOME_TENANT_ID);
    });

    it("counts the settings only from the role in the home tenant, and the groups in every tenant", async () => {
      // Full access in a customer tenant reaches its data and its groups, never the settings of the instance.
      signedIn(account("user-1", {
        memberships: [{ tenantId: "tenant-a", permissions: "[]", fullAccess: true }],
      }), "tenant-a");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.permissions).toContain(PERMISSIONS.JOBS.WRITE);
      expect(ctx!.permissions).toContain(PERMISSIONS.PROFILE.UPDATE_NAME);
      expect(ctx!.permissions).not.toContain(PERMISSIONS.SETTINGS.WRITE);
      expect(ctx!.permissions).toContain(PERMISSIONS.GROUPS.WRITE);
      expect(ctx!.permissions).toContain(PERMISSIONS.TENANT_SETTINGS.WRITE);
    });

    it("keeps the settings of a home role while the session works in another tenant", async () => {
      signedIn(account("user-1", {
        memberships: [
          { tenantId: HOME_TENANT_ID, permissions: JSON.stringify([PERMISSIONS.SETTINGS.READ, PERMISSIONS.JOBS.WRITE]) },
          { tenantId: "tenant-a", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]) },
        ],
      }), "tenant-a");

      const ctx = await getAuthContext(new Headers());

      expect(ctx!.permissions).toEqual([PERMISSIONS.JOBS.READ, PERMISSIONS.SETTINGS.READ]);
    });
  });

  // ========================================================================
  // checkPermissionWithContext()
  // ========================================================================
  describe("checkPermissionWithContext", () => {
    it("should allow access when permission is present", () => {
      const ctx = ctxOf({ permissions: ["jobs:read", "jobs:execute", "history:read"] });

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);
      }).not.toThrow();
    });

    it("should throw PermissionError when permission is missing", () => {
      const ctx = ctxOf({ permissions: ["jobs:read"] });

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);
      }).toThrow(PermissionError);
    });

    it("should bypass permission check for platform admin sessions", () => {
      const ctx = ctxOf({
        userId: "admin-1",
        permissions: [], // empty, but a platform admin bypasses
        isPlatformAdmin: true,
        authMethod: "session",
      });

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);
      }).not.toThrow();
    });

    it("should NOT bypass for API key even with isPlatformAdmin false", () => {
      const ctx = ctxOf({ permissions: [], apiKeyId: "key-1" });

      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
      }).toThrow(PermissionError);
    });

    it("should check exact permission string match", () => {
      const ctx = ctxOf({ permissions: ["jobs:read"], authMethod: "session" });

      // jobs:read does NOT grant jobs:write
      expect(() => {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);
      }).toThrow(PermissionError);
    });

    it("tells a platform admin in All tenants that the view only reads, instead of naming a right they hold in every tenant", () => {
      const ctx = ctxOf({ isPlatformAdmin: true, allTenants: true, tenantId: null, authMethod: "session", permissions: [PERMISSIONS.SOURCES.READ] });

      expect(() => checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.WRITE)).toThrow(ALL_TENANTS_REFUSAL);
      expect(() => tenantOf(ctx)).toThrow(ALL_TENANTS_REFUSAL);
    });

    it("names the right that is missing outside All tenants, and for a read in All tenants", () => {
      expect(() => checkPermissionWithContext(ctxOf({ permissions: [] }), PERMISSIONS.SOURCES.WRITE)).toThrow("Permission denied: sources:write required");
      expect(() => checkPermissionWithContext(ctxOf({ allTenants: true, tenantId: null, permissions: [] }), PERMISSIONS.SOURCES.READ)).toThrow("Permission denied: sources:read required");
      expect(() => tenantOf({ tenantId: null })).toThrow("You work in no tenant yet.");
    });
  });

  // ========================================================================
  // checkAnyPermissionWithContext()
  // ========================================================================
  describe("checkAnyPermissionWithContext", () => {
    const readOnly = [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD] as const;
    const ctxWith = (permissions: string[], isPlatformAdmin = false): AuthContext => ctxOf({ permissions, isPlatformAdmin });

    it("lets a download-only integration read a backup's contents", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.DOWNLOAD]), readOnly)).not.toThrow();
    });

    it("lets a restore-only user read a backup's contents", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.RESTORE]), readOnly)).not.toThrow();
    });

    it("refuses a user holding neither, naming both", () => {
      // Matching a whole PermissionError instance would compare its timestamp
      // too, which flakes whenever a millisecond passes between the two.
      const refuse = () => checkAnyPermissionWithContext(ctxWith([PERMISSIONS.STORAGE.READ]), readOnly);
      expect(refuse).toThrow(PermissionError);
      expect(refuse).toThrow(`${PERMISSIONS.STORAGE.RESTORE} or ${PERMISSIONS.STORAGE.DOWNLOAD}`);
    });

    it("lets a platform admin session through", () => {
      expect(() => checkAnyPermissionWithContext(ctxWith([], true), readOnly)).not.toThrow();
    });
  });

  // ========================================================================
  // getViewer()
  // ========================================================================
  describe("getViewer", () => {
    it("should return null when session throws", async () => {
      mockGetSession.mockRejectedValue(new Error("headers unavailable"));

      const result = await getViewer();

      expect(result).toBeNull();
    });

    it("should return null when no session user", async () => {
      mockGetSession.mockResolvedValue(null);

      const result = await getViewer();

      expect(result).toBeNull();
    });

    it("never takes the viewer from an API key", async () => {
      mockGetSession.mockResolvedValue(null);
      mockValidate.mockResolvedValue({ id: "key-1", userId: "user-1", permissions: ["jobs:read"], tenantId: HOME_TENANT_ID });

      expect(await getViewer()).toBeNull();
    });

    it("should return user with their role in the tenant", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read"]' }] }));
      mockPrismaMembership.findUnique.mockResolvedValue({ group: { id: "g-1", name: "Editors" } });

      const result = await getViewer();

      expect(result).not.toBeNull();
      expect(result!.id).toBe("user-1");
      expect(result!.role).toEqual({ id: "g-1", name: "Editors" });
      expect(result!.tenantId).toBe(HOME_TENANT_ID);
      expect(result!.permissions).toEqual(["jobs:read"]);
      expect(mockPrismaMembership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_tenantId: { userId: "user-1", tenantId: HOME_TENANT_ID } } }),
      );
    });

    it("should make the first account the platform admin with the full access role in the home tenant", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1" } });
      const promoted = account("user-1", { platformRole: "ADMIN", memberships: [{ permissions: "[]", fullAccess: true }] });
      mockPrismaUser.findUnique
        .mockResolvedValueOnce(account("user-1"))
        .mockResolvedValue(promoted);
      mockPrismaUser.count.mockResolvedValue(1);
      mockEnsureFullAccessGroup.mockResolvedValue("g-1");
      mockPrismaMembership.findUnique.mockResolvedValue({ group: { id: "g-1", name: "Admin" } });

      const result = await getViewer();

      expect(result!.isPlatformAdmin).toBe(true);
      expect(result!.role!.name).toBe("Admin");
      // Found or made in the same transaction as the promotion.
      expect(mockEnsureFullAccessGroup).toHaveBeenCalledWith(mockTx);
      expect(mockTx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { platformRole: "ADMIN" } });
      expect(mockTx.tenantMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId_tenantId: { userId: "user-1", tenantId: HOME_TENANT_ID } },
        create: { userId: "user-1", tenantId: HOME_TENANT_ID, groupId: "g-1" },
      }));
    });

    it("should not auto-promote when multiple users exist", async () => {
      signedIn(account("user-1"));
      mockPrismaUser.count.mockResolvedValue(3);

      const result = await getViewer();

      expect(mockEnsureFullAccessGroup).not.toHaveBeenCalled();
      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(mockTx.tenantMembership.upsert).not.toHaveBeenCalled();
      expect(result!.isPlatformAdmin).toBe(false);
      expect(result!.role).toBeNull();
      expect(result!.permissions).toEqual([]);
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
      signedIn(account("user-1"));
      mockPrismaUser.count.mockResolvedValue(2); // no auto-promote

      await expect(checkPermission(PERMISSIONS.JOBS.READ)).rejects.toThrow(PermissionError);
    });

    it("should return user for a platform admin regardless of permission", async () => {
      signedIn(account("admin-1", { platformRole: "ADMIN" }));

      const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

      expect(user.id).toBe("admin-1");
      expect(user.isPlatformAdmin).toBe(true);
    });

    it("should return user when permission is present in group", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read","jobs:execute"]' }] }));

      const user = await checkPermission(PERMISSIONS.JOBS.EXECUTE);

      expect(user.id).toBe("user-1");
    });

    it("should throw PermissionError when permission is missing from group", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read"]' }] }));

      await expect(checkPermission(PERMISSIONS.JOBS.EXECUTE)).rejects.toThrow(PermissionError);
    });

    it("should throw PermissionError when group permissions JSON is invalid", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: "not-valid-json" }] }));

      await expect(checkPermission(PERMISSIONS.JOBS.READ)).rejects.toThrow(PermissionError);
    });

    it("refuses what the role holds only in another tenant", async () => {
      signedIn(account("user-1", {
        memberships: [
          { tenantId: "tenant-a", permissions: '["jobs:read"]' },
          { tenantId: "tenant-b", permissions: '["jobs:read","jobs:execute"]' },
        ],
      }), "tenant-a");

      await expect(checkPermission(PERMISSIONS.JOBS.EXECUTE)).rejects.toThrow(PermissionError);
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
      signedIn(account("user-1"));
      mockPrismaUser.count.mockResolvedValue(2);

      const perms = await getUserPermissions();

      expect(perms).toEqual([]);
    });

    it("should return all available permissions for a platform admin", async () => {
      signedIn(account("admin-1", { platformRole: "ADMIN" }));

      const perms = await getUserPermissions();

      expect(perms.length).toBe(AVAILABLE_PERMISSIONS.length + PLATFORM_ONLY_PERMISSIONS.length + 1);
      expect(perms).toContain(PERMISSIONS.SETTINGS.WRITE);
    });

    it("should return parsed permissions for regular user", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read","history:read"]' }] }));

      const perms = await getUserPermissions();

      expect(perms).toEqual(["jobs:read", "history:read"]);
    });

    it("should return empty array when permissions JSON is invalid", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: "{invalid" }] }));

      const perms = await getUserPermissions();

      expect(perms).toEqual([]);
    });
  });

  // ========================================================================
  // hasPermission()
  // ========================================================================
  describe("hasPermission", () => {
    it("should return true when user has the permission", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:execute"]' }] }));

      const result = await hasPermission(PERMISSIONS.JOBS.EXECUTE);

      expect(result).toBe(true);
    });

    it("should return false when user lacks the permission", async () => {
      signedIn(account("user-1", { memberships: [{ permissions: '["jobs:read"]' }] }));

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
