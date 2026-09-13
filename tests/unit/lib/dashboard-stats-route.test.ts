import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionError, ApiKeyError } from "@/lib/logging/errors";
import type { AuthContext } from "@/lib/auth/access-control";

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

const mockGetAuthContext = vi.fn();
const mockCheckPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
  checkPermissionWithContext: (...args: unknown[]) => mockCheckPermissionWithContext(...args),
}));

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

const mockGetDashboardStats = vi.fn();
const mockGetStorageVolumeCacheAge = vi.fn();
vi.mock("@/services/dashboard-service", () => ({
  getDashboardStats: (...args: unknown[]) => mockGetDashboardStats(...args),
  getStorageVolumeCacheAge: (...args: unknown[]) => mockGetStorageVolumeCacheAge(...args),
}));

// Import route handler after mocks
const { GET } = await import("@/app/api/dashboard/stats/route");

function apiKeyContext(permissions: string[]): AuthContext {
  return {
    userId: "user-1",
    permissions,
    isSuperAdmin: false,
    authMethod: "apikey",
    apiKeyId: "key-1",
  };
}

const stats = {
  totalJobs: 8,
  activeSchedules: 8,
  success24h: 29,
  failed24h: 0,
  totalSnapshots: 122,
  totalStorageBytes: 55179592335,
  successRate30d: 100,
};

describe("GET /api/dashboard/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockReturnValue(new Headers());
    // Same rule as the real guard, so the tests prove which permission the route asks for.
    mockCheckPermissionWithContext.mockImplementation((ctx: AuthContext, permission: string) => {
      if (!ctx.isSuperAdmin && !ctx.permissions.includes(permission)) {
        throw new PermissionError(permission);
      }
    });
    mockGetDashboardStats.mockResolvedValue(stats);
    mockGetStorageVolumeCacheAge.mockResolvedValue("2026-09-13T10:00:00.000Z");
  });

  it("rejects a request without credentials before loading any stats", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(mockGetDashboardStats).not.toHaveBeenCalled();
  });

  it("rejects a disabled API key", async () => {
    mockGetAuthContext.mockRejectedValue(new ApiKeyError("disabled", "API key is disabled"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(mockGetDashboardStats).not.toHaveBeenCalled();
  });

  it("does not accept history read access in place of dashboard:read", async () => {
    mockGetAuthContext.mockResolvedValue(apiKeyContext(["history:read", "jobs:read", "storage:read"]));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockGetDashboardStats).not.toHaveBeenCalled();
  });

  it("returns the overview figures and the storage cache age to a key holding only dashboard:read", async () => {
    mockGetAuthContext.mockResolvedValue(apiKeyContext(["dashboard:read"]));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { ...stats, storageUpdatedAt: "2026-09-13T10:00:00.000Z" },
    });
  });

  it("reports a never-filled storage cache as null instead of omitting the field", async () => {
    mockGetAuthContext.mockResolvedValue(apiKeyContext(["dashboard:read"]));
    mockGetStorageVolumeCacheAge.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveProperty("storageUpdatedAt", null);
  });

  it("hides internal error details when the stats cannot be loaded", async () => {
    mockGetAuthContext.mockResolvedValue(apiKeyContext(["dashboard:read"]));
    mockGetDashboardStats.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).not.toContain("SQLITE_BUSY");
  });
});
