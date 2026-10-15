import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ApiKeyError, ServiceError } from "@/lib/logging/errors";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockGetAuthContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}));

vi.mock("next/headers", () => ({ headers: () => new Headers() }));

const mockCreateSnapshot = vi.fn();
vi.mock("@/services/system/database-service", () => ({
    createDatabaseSnapshot: (...args: unknown[]) => mockCreateSnapshot(...args),
}));

const mockAuditLog = vi.fn();
vi.mock("@/services/audit-service", () => ({
    auditService: { logFor: (...args: unknown[]) => mockAuditLog(...args) },
}));

const mockStream = vi.fn();
vi.mock("@/lib/server/temp-file-response", () => ({
    tempFileDownloadResponse: (...args: unknown[]) => mockStream(...args),
}));

const { POST, GET } = await import("@/app/api/settings/database/download/route");
const { DATABASE_BUSY } = await import("@/lib/server/database-maintenance");

const platformAdmin = { userId: "admin-1", permissions: [], isPlatformAdmin: true, authMethod: "session", tenantId: "default" };

function getRequest(token?: string) {
    const url = new URL("http://localhost:3000/api/settings/database/download");
    if (token) url.searchParams.set("token", token);
    return new NextRequest(url, { method: "GET" });
}

describe("Database download route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateSnapshot.mockResolvedValue({
            tempFile: "/tmp/dbackup-database-1-abc.db",
            fileName: "dbackup-database_2026-09-16_12-00-00.db",
            sizeBytes: 4096,
        });
        mockStream.mockReturnValue(new Response("sqlite bytes"));
    });

    it("rejects requests without a session", async () => {
        mockGetAuthContext.mockResolvedValue(null);

        const response = await POST();

        expect(response.status).toBe(401);
        expect(mockCreateSnapshot).not.toHaveBeenCalled();
    });

    it("rejects an invalid API key as unauthorized instead of failing", async () => {
        mockGetAuthContext.mockRejectedValue(new ApiKeyError("disabled", "API key is disabled"));

        const response = await POST();

        expect(response.status).toBe(401);
    });

    it("refuses anyone who is no platform admin, even with every settings permission of the home tenant", async () => {
        mockGetAuthContext.mockResolvedValue({
            userId: "admin-2",
            permissions: ["settings:read", "settings:write"],
            isPlatformAdmin: false,
            authMethod: "session",
            tenantId: "default",
        });

        const response = await POST();

        expect(response.status).toBe(403);
        expect(mockCreateSnapshot).not.toHaveBeenCalled();
    });

    it("refuses API keys", async () => {
        mockGetAuthContext.mockResolvedValue({ ...platformAdmin, authMethod: "apikey", apiKeyId: "key-1" });

        const response = await POST();

        expect(response.status).toBe(403);
    });

    it("reports a running backup as a conflict and records nothing in the audit log", async () => {
        mockGetAuthContext.mockResolvedValue(platformAdmin);
        mockCreateSnapshot.mockRejectedValue(
            new ServiceError("DatabaseService", "snapshot", "1 run is in progress.", { code: DATABASE_BUSY })
        );

        const response = await POST();
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body.error).toBe("1 run is in progress.");
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it("hides internal error details from the response", async () => {
        mockGetAuthContext.mockResolvedValue(platformAdmin);
        mockCreateSnapshot.mockRejectedValue(new Error("SQLITE_IOERR at /data/db/dbackup.db"));

        const response = await POST();
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).not.toContain("/data/db");
    });

    it("prepares a copy, audits it and lets only the same user collect it once", async () => {
        mockGetAuthContext.mockResolvedValue(platformAdmin);

        const prepared = await POST();
        const { data } = await prepared.json();

        expect(prepared.status).toBe(200);
        expect(data.fileName).toBe("dbackup-database_2026-09-16_12-00-00.db");
        expect(mockAuditLog).toHaveBeenCalledWith(platformAdmin, "EXPORT", "SYSTEM", expect.objectContaining({ action: "database_download" }));

        // Another platform admin cannot redeem the token.
        mockGetAuthContext.mockResolvedValue({ ...platformAdmin, userId: "admin-3" });
        expect((await GET(getRequest(data.token))).status).toBe(410);

        mockGetAuthContext.mockResolvedValue(platformAdmin);
        const download = await GET(getRequest(data.token));
        expect(download.status).toBe(200);
        expect(mockStream).toHaveBeenCalledWith(
            "/tmp/dbackup-database-1-abc.db",
            "dbackup-database_2026-09-16_12-00-00.db",
            "application/vnd.sqlite3"
        );

        expect((await GET(getRequest(data.token))).status).toBe(410);
    });

    it("does not accept a download without a token", async () => {
        mockGetAuthContext.mockResolvedValue(platformAdmin);

        const response = await GET(getRequest());

        expect(response.status).toBe(410);
        expect(mockStream).not.toHaveBeenCalled();
    });
});
