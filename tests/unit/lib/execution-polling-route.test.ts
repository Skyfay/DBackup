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
}));

// Mock next/headers
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

// Mock prisma
const mockFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  default: {
    execution: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/auth/permissions", () => ({
  PERMISSIONS: {
    HISTORY: { READ: "history:read" },
  },
}));

// Import route handler after mocks
const { GET } = await import("@/app/api/executions/[id]/route");

describe("GET /api/executions/[id]", () => {
  const fakeHeaders = new Headers();

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockReturnValue(fakeHeaders);
  });

  function createRequest(url = "http://localhost:3000/api/executions/exec-1") {
    return new NextRequest(url, { method: "GET" });
  }

  function createProps(id = "exec-1") {
    return { params: Promise.resolve({ id }) };
  }

  const baseExecution = {
    id: "exec-1",
    jobId: "job-1",
    type: "Backup",
    status: "Running",
    startedAt: new Date("2026-02-15T10:00:00Z"),
    endedAt: null,
    size: null,
    path: null,
    metadata: JSON.stringify({ progress: 45, stage: "Uploading" }),
    logs: "[]",
    job: { id: "job-1", name: "Daily MySQL Backup" },
  };

  it("should return 401 when not authenticated", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 for disabled API key", async () => {
    mockGetAuthContext.mockRejectedValue(new ApiKeyError("disabled", "API key is disabled"));

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("should return 403 when permission is missing", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      isSuperAdmin: false,
      authMethod: "apikey",
    });
    mockCheckPermissionWithContext.mockImplementation(() => {
      throw new PermissionError("history:read");
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it("should return 404 when execution does not exist", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), createProps("nonexistent"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return execution data with progress and stage from metadata", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "apikey",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({ ...baseExecution });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("exec-1");
    expect(body.data.jobName).toBe("Daily MySQL Backup");
    expect(body.data.type).toBe("Backup");
    expect(body.data.status).toBe("Running");
    expect(body.data.progress).toBe(45);
    expect(body.data.stage).toBe("Uploading");
    expect(body.data.startedAt).toBe("2026-02-15T10:00:00.000Z");
    expect(body.data.endedAt).toBeNull();
    expect(body.data.error).toBeNull();
  });

  it("should calculate live duration for running executions", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);

    const startedAt = new Date(Date.now() - 5000); // 5 seconds ago
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      startedAt,
      endedAt: null,
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    // Duration should be approximately 5000ms (allow some tolerance)
    expect(body.data.duration).toBeGreaterThan(4000);
    expect(body.data.duration).toBeLessThan(10000);
  });

  it("should calculate final duration for completed executions", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);

    const startedAt = new Date("2026-02-15T10:00:00Z");
    const endedAt = new Date("2026-02-15T10:02:30Z"); // 2min 30sec later
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      status: "Success",
      startedAt,
      endedAt,
      size: BigInt(1048576),
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(body.data.duration).toBe(150000); // 150 seconds
    expect(body.data.size).toBe(1048576);
  });

  it("should extract error message from logs when status is Failed", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);

    const logs = JSON.stringify([
      { level: "info", message: "Starting backup..." },
      { level: "info", message: "Dumping database..." },
      { level: "error", message: "Connection refused: ECONNREFUSED" },
    ]);

    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      status: "Failed",
      endedAt: new Date(),
      metadata: "{}",
      logs,
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(body.data.status).toBe("Failed");
    expect(body.data.error).toBe("Connection refused: ECONNREFUSED");
  });

  it("should not include logs by default", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({ ...baseExecution });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(body.data.logs).toBeUndefined();
  });

  it("should include logs when includeLogs=true", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);

    const logEntries = [
      { level: "info", message: "Starting backup..." },
      { level: "info", message: "Dump complete" },
    ];
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      logs: JSON.stringify(logEntries),
    });

    const url = "http://localhost:3000/api/executions/exec-1?includeLogs=true";
    const response = await GET(createRequest(url), createProps());
    const body = await response.json();

    expect(body.data.logs).toEqual(logEntries);
  });

  it("tells the dialog when data retention removed the log", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      status: "Success",
      endedAt: new Date("2026-02-15T10:05:00Z"),
      logs: "[]",
      logsPurgedAt: new Date("2026-05-16T00:00:00Z"),
    });

    const url = "http://localhost:3000/api/executions/exec-1?includeLogs=true";
    const response = await GET(createRequest(url), createProps());
    const body = await response.json();

    expect(body.data.logs).toEqual([]);
    expect(body.data.logsPurgedAt).toBe("2026-05-16T00:00:00.000Z");
  });

  it("should return empty logs array when logs are unparseable and includeLogs=true", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      logs: "not-valid-json",
    });

    const url = "http://localhost:3000/api/executions/exec-1?includeLogs=true";
    const response = await GET(createRequest(url), createProps());
    const body = await response.json();

    expect(body.data.logs).toEqual([]);
  });

  it("should handle null metadata gracefully", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      metadata: null,
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(body.data.progress).toBeNull();
    expect(body.data.stage).toBeNull();
  });

  it("should handle execution without job relationship", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: ["history:read"],
      isSuperAdmin: false,
      authMethod: "session",
    });
    mockCheckPermissionWithContext.mockReturnValue(undefined);
    mockFindUnique.mockResolvedValue({
      ...baseExecution,
      job: null,
    });

    const response = await GET(createRequest(), createProps());
    const body = await response.json();

    expect(body.data.jobName).toBeNull();
  });
});
