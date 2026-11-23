import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError, ApiKeyError, NotFoundError } from "@/lib/logging/errors";
import { recordKeyRefusal } from "@/lib/auth/api-key-refusal";

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
const mockAuditLogFor = vi.fn();
vi.mock("@/services/audit-service", () => ({
  auditService: {
    logFor: (...args: any[]) => mockAuditLogFor(...args),
  },
}));

// The name of the job, for the audit entry
vi.mock("@/services/jobs/job-audit", () => ({
  jobAuditName: async () => "Shop nightly",
}));

// Mock apiKeyService
const mockApiKeyGetById = vi.fn();
vi.mock("@/services/auth/api-key-service", () => ({
  apiKeyService: {
    getById: (...args: any[]) => mockApiKeyGetById(...args),
  },
}));

// Mock userService (used to look up user name for session-auth trigger label)
const mockUserNameOf = vi.fn();
vi.mock("@/services/user/user-service", () => ({
  userService: {
    nameOf: (...args: any[]) => mockUserNameOf(...args),
  },
}));

vi.mock("@/lib/auth/permissions", () => ({
  PERMISSIONS: {
    JOBS: { EXECUTE: "jobs:execute" },
    STORAGE: { DELETE: "storage:delete" },
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
    mockUserNameOf.mockResolvedValue("Test User");
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
    // A refused key leaves no context and its reason, see `getAuthContext`.
    mockGetAuthContext.mockImplementation(async (headers: Headers) => {
      recordKeyRefusal(headers, new ApiKeyError("disabled", "API key is disabled").message);
      return null;
    });

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toContain("disabled");
  });

  it("should return 401 for expired API key", async () => {
    // A refused key leaves no context and its reason, see `getAuthContext`.
    mockGetAuthContext.mockImplementation(async (headers: Headers) => {
      recordKeyRefusal(headers, new ApiKeyError("expired", "API key has expired").message);
      return null;
    });

    const response = await POST(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("should return 403 when permission is missing", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:read"],
      isPlatformAdmin: false,
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
      isPlatformAdmin: false,
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
    mockAuditLogFor.mockResolvedValue(undefined);

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
      isPlatformAdmin: false,
      authMethod: "apikey",
      apiKeyId: "key-99",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockResolvedValue({
      success: true,
      executionId: "exec-1",
      message: "Queued",
    });
    mockAuditLogFor.mockResolvedValue(undefined);

    await POST(createRequest(), createProps("job-1"));

    // The key goes with the caller, so the entry names it in its own column too.
    expect(mockAuditLogFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", authMethod: "apikey", apiKeyId: "key-99" }),
      "execute",
      "job",
      expect.objectContaining({
        name: "Shop nightly",
        executionId: "exec-1",
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
      isPlatformAdmin: true,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockResolvedValue({
      success: true,
      executionId: "exec-2",
      message: "Queued",
    });
    mockAuditLogFor.mockResolvedValue(undefined);

    await POST(createRequest(), createProps("job-2"));

    expect(mockAuditLogFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", authMethod: "session" }),
      "execute",
      "job",
      expect.objectContaining({
        name: "Shop nightly",
        trigger: "manual",
      }),
      "job-2"
    );
  });

  it("should return 500 when executeJob fails", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:execute"],
      isPlatformAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockRejectedValue(new Error("SQLITE_BUSY at /data/dbackup.db"));

    const response = await POST(createRequest(), createProps("nonexistent"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    // The detail goes to the log, never to the caller.
    expect(body.error).toBe("The job could not be started. The log of DBackup has the details.");
  });

  it("answers 404 for a job the tenant does not hold, like for one that does not exist", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["jobs:execute"],
      isPlatformAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockExecuteJob.mockRejectedValue(new NotFoundError("Job", "job-of-another-tenant"));

    const response = await POST(createRequest(), createProps("job-of-another-tenant"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: "Job not found" });
    expect(mockAuditLogFor).not.toHaveBeenCalled();
  });

  describe("locking the backup of the run", () => {
    const ctx = { userId: "user-1", permissions: ["jobs:execute"], isPlatformAdmin: false, authMethod: "apikey", apiKeyId: "key-1" };
    const withBody = (body: unknown) => new NextRequest("http://localhost:3000/api/jobs/job-1/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    beforeEach(() => {
      // The real check, against the permissions of the request.
      mockCheckPermissionWithContext.mockImplementation((context: { permissions: string[] }, permission: string) => {
        if (!context.permissions.includes(permission)) throw new PermissionError(permission);
      });
      mockExecuteJob.mockResolvedValue({ success: true, executionId: "exec-1" });
    });

    it("locks it for a key that may run the job, like the key of a CI pipeline", async () => {
      mockGetAuthContext.mockResolvedValue(ctx);
      expect((await POST(withBody({ lock: true }), createProps())).status).toBe(200);
      expect(mockCheckPermissionWithContext).not.toHaveBeenCalledWith(ctx, "storage:delete");
      expect(mockExecuteJob).toHaveBeenLastCalledWith("job-1", expect.anything(), { lock: true });

      mockGetAuthContext.mockResolvedValue(ctx);
      expect((await POST(withBody({ lock: false }), createProps())).status).toBe(200);
      expect((await POST(createRequest(), createProps())).status).toBe(200);
    });
  });
});
