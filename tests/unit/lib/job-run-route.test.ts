import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError, ApiKeyError } from "@/lib/logging/errors";

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

// Mock getAuthContext and checkPermissionWithContext
const mockGetAuthContext = vi.fn();
const mockCheckPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
  getAuthContext: (...args: any[]) => mockGetAuthContext(...args),
  checkPermissionWithContext: (...args: any[]) => mockCheckPermissionWithContext(...args),
  AuthContext: {},
}));

// Mock next/headers
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

// Mock backupService
const mockExecuteJob = vi.fn();
vi.mock("@/services/backup/backup-service", () => ({
  backupService: {
    executeJob: (...args: any[]) => mockExecuteJob(...args),
  },
}));

// Mock auditService
const mockAuditLog = vi.fn();
vi.mock("@/services/audit-service", () => ({
  auditService: {
    log: (...args: any[]) => mockAuditLog(...args),
  },
}));

// Mock apiKeyService
const mockApiKeyGetById = vi.fn();
vi.mock("@/services/auth/api-key-service", () => ({
  apiKeyService: {
    getById: (...args: any[]) => mockApiKeyGetById(...args),
  },
}));

// Mock prisma (used to look up user name for session-auth trigger label)
const mockUserFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/auth/permissions", () => ({
  PERMISSIONS: {
    JOBS: { EXECUTE: "jobs:execute" },
  },
}));

vi.mock("@/lib/core/audit-types", () => ({
  AUDIT_ACTIONS: { EXECUTE: "execute" },
  AUDIT_RESOURCES: { JOB: "job" },
}));

// Import route handler after mocks
const { POST } = await import("@/app/api/jobs/[id]/run/route");

describe("POST /api/jobs/[id]/run", () => {
  const fakeHeaders = new Headers();

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockReturnValue(fakeHeaders);
    mockApiKeyGetById.mockResolvedValue({ name: "Test API Key" });
    mockUserFindUnique.mockResolvedValue({ name: "Test User" });
  });

  function createRequest() {
    return new NextRequest("http://localhost:3000/api/jobs/job-1/run", {
      method: "POST",
    });
  }

  function createProps(id = "job-1") {
    return { params: Promise.resolve({ id }) };
  }

  it("should return 401 when not authenticated", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 for disabled API key", async () => {
    mockGetAuthContext.mockRejectedValue(new ApiKeyError("disabled", "API key is disabled"));

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toContain("disabled");
  });

  it("should return 401 for expired API key", async () => {
    mockGetAuthContext.mockRejectedValue(new ApiKeyError("expired", "API key has expired"));

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("should return 403 when permission is missing", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:read"],
      isSuperAdmin: false,
      authMethod: "apikey",
    });
    mockCheckPermissionWithContext.mockImplementation(() => {
      throw new PermissionError("jobs:execute");
    });

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Permission");
  });

  it("should trigger backup and return executionId on success", async () => {
    const ctx = {
      userId: "user-1",
      permissions: ["jobs:execute"],
      isSuperAdmin: false,
      authMethod: "apikey",
      apiKeyId: "key-1",
    };
    mockGetAuthContext.mockResolvedValue(ctx);
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockResolvedValue({
      success: true,
      executionId: "exec-123",
      message: "Job queued successfully",
    });
    mockAuditLog.mockResolvedValue(undefined);

    const response = await POST(createRequest(), createProps("job-42"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.executionId).toBe("exec-123");

    // Backup service was called with the correct job ID and trigger info
    expect(mockExecuteJob).toHaveBeenCalledWith("job-42", expect.objectContaining({ type: "Api" }), expect.any(Object));
  });

  it("should log audit event with trigger=api for API key auth", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:execute"],
      isSuperAdmin: false,
      authMethod: "apikey",
      apiKeyId: "key-99",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockResolvedValue({
      success: true,
      executionId: "exec-1",
      message: "Queued",
    });
    mockAuditLog.mockResolvedValue(undefined);

    await POST(createRequest(), createProps("job-1"));

    expect(mockAuditLog).toHaveBeenCalledWith(
      "user-1",
      "execute",
      "job",
      expect.objectContaining({
        trigger: "api",
        apiKeyId: "key-99",
      }),
      "job-1"
    );
  });

  it("should log audit event with trigger=manual for session auth", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:execute"],
      isSuperAdmin: true,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockResolvedValue({
      success: true,
      executionId: "exec-2",
      message: "Queued",
    });
    mockAuditLog.mockResolvedValue(undefined);

    await POST(createRequest(), createProps("job-2"));

    expect(mockAuditLog).toHaveBeenCalledWith(
      "user-1",
      "execute",
      "job",
      expect.objectContaining({
        trigger: "manual",
      }),
      "job-2"
    );
  });

  it("should return 500 when executeJob fails", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:execute"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockRejectedValue(new Error("Job not found"));

    const response = await POST(createRequest(), createProps("nonexistent"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Job not found");
  });
});
