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
    },
}));

const mockResolveAdapterConfig = vi.fn();
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

const mockList = vi.fn();
const mockRegistryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (...args: any[]) => mockRegistryGet(...args) },
}));

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
        mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
        mockResolveAdapterConfig.mockImplementation(async (config: unknown) => config);
        mockRegistryGet.mockReturnValue({ id: "local-filesystem", type: "storage", list: mockList });
        mockFindUnique.mockResolvedValue({ id: "dest-1", type: "storage", adapterId: "local-filesystem", config: "{}" });
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
        mockFindUnique.mockResolvedValue({ id: "dest-1", type: "database", adapterId: "mysql", config: "{}" });
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
});
