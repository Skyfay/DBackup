import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/adapters", () => ({
    registerAdapters: vi.fn(),
}));

const mockGetAuthContext = vi.fn();
const mockCheckPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: any[]) => mockGetAuthContext(...args),
    checkPermissionWithContext: (...args: any[]) => mockCheckPermissionWithContext(...args),
}));

vi.mock("next/headers", () => ({
    headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth/permissions", () => ({
    PERMISSIONS: {
        STORAGE: { RESTORE: "storage:restore" },
    },
}));

const mockFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findUnique: (...args: any[]) => mockFindUnique(...args),
        },
        // Nobody shares the destination, so its tenant sees it as it is.
        connectionShare: { count: async () => 0 },
    },
}));

vi.mock("@/services/sharing/provided", () => ({ providedConnection: vi.fn().mockResolvedValue(null) }));

const mockResolveAdapterConfig = vi.fn();
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

const mockList = vi.fn();
const mockRegistryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (...args: any[]) => mockRegistryGet(...args) },
}));

const mockLogFor = vi.fn();
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: any[]) => mockLogFor(...args) } }));

const { POST } = await import("@/app/api/storage/[id]/check-path/route");

function createRequest(body: unknown) {
    return new NextRequest("http://localhost:3000/api/storage/dest-1/check-path", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

function createProps(id = "dest-1") {
    return { params: Promise.resolve({ id }) };
}

describe("POST /api/storage/[id]/check-path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAuthContext.mockResolvedValue({ userId: "user-1", tenantId: "acme" });
        mockResolveAdapterConfig.mockImplementation(async (config: unknown) => config);
        mockRegistryGet.mockReturnValue({ id: "local-filesystem", type: "storage", list: mockList });
        mockFindUnique.mockResolvedValue({ id: "dest-1", name: "NAS", type: "storage", storageRole: "DESTINATION", adapterId: "local-filesystem", config: "{}", tenantId: "acme" });
    });

    it("returns 401 when not authenticated", async () => {
        mockGetAuthContext.mockResolvedValue(null);
        const res = await POST(createRequest({ path: "/restore" }), createProps());
        expect(res.status).toBe(401);
    });

    it("returns 400 for a path containing '..'", async () => {
        const res = await POST(createRequest({ path: "../etc" }), createProps());
        expect(res.status).toBe(400);
    });

    it("returns 404 when the adapter config is not a storage adapter", async () => {
        mockFindUnique.mockResolvedValue({ id: "dest-1", type: "database", adapterId: "mysql", config: "{}", tenantId: "acme" });
        const res = await POST(createRequest({ path: "/restore" }), createProps());
        expect(res.status).toBe(404);
    });

    it("returns status 'occupied' when the target path already contains files", async () => {
        mockList.mockResolvedValue([{ name: "a.txt", path: "a.txt", size: 10, lastModified: new Date() }]);
        const res = await POST(createRequest({ path: "/restore" }), createProps());
        const body = await res.json();
        expect(body).toEqual({ status: "occupied", itemCount: 1 });
    });

    it("returns status 'empty' when the target path has no files", async () => {
        mockList.mockResolvedValue([]);
        const res = await POST(createRequest({ path: "/restore" }), createProps());
        const body = await res.json();
        expect(body).toEqual({ status: "empty", itemCount: 0 });
    });

    it("returns status 'unverified' when list() throws", async () => {
        mockList.mockRejectedValue(new Error("connection refused"));
        const res = await POST(createRequest({ path: "/restore" }), createProps());
        const body = await res.json();
        expect(body).toEqual({ status: "unverified" });
    });

    it("checks the folder of a directory source, which a restore of files writes back into", async () => {
        mockFindUnique.mockResolvedValue({ id: "dest-1", name: "NAS photos", type: "storage", storageRole: "SOURCE", adapterId: "local-filesystem", config: "{}", tenantId: "acme" });
        mockList.mockResolvedValue([{ name: "a.jpg", path: "a.jpg", size: 10, lastModified: new Date() }]);
        const res = await POST(createRequest({ path: "photos" }), createProps());
        expect(await res.json()).toEqual({ status: "occupied", itemCount: 1 });
    });

    it("notes the check in the audit log with the storage and the folder, and nothing for a storage that is not found", async () => {
        mockList.mockResolvedValue([]);
        await POST(createRequest({ path: "restore" }), createProps());
        expect(mockLogFor).toHaveBeenCalledExactlyOnceWith(
            { userId: "user-1", tenantId: "acme" }, "EXECUTE", "ADAPTER", { action: "path_check", name: "NAS", path: "restore", success: true }, "dest-1", { tenantId: "acme" },
        );

        mockLogFor.mockClear();
        mockFindUnique.mockResolvedValue(null);
        expect((await POST(createRequest({ path: "restore" }), createProps())).status).toBe(404);
        expect(mockLogFor).not.toHaveBeenCalled();
    });
});
