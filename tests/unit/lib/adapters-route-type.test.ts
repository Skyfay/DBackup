/**
 * The adapters route checks the permission of the kind of connection a request names. A kind it
 * does not know has no permission to check, so the request is refused before anything is read or
 * created, whatever the caller may do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    checked: [] as string[],
    create: vi.fn(),
    list: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn().mockResolvedValue({ userId: "u-viewer", tenantId: "acme" }),
    checkPermissionWithContext: vi.fn((_ctx: unknown, permission: string) => mocks.checked.push(permission)),
    hasPermissionWithContext: vi.fn().mockReturnValue(false),
}));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/services/adapters/adapter-create", () => ({ createAdapter: mocks.create }));
vi.mock("@/services/adapters/adapter-list", () => ({ listAdapters: mocks.list }));

const { GET, POST } = await import("@/app/api/adapters/route");

const post = (body: Record<string, unknown>) =>
    POST(new NextRequest("http://localhost/api/adapters", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.checked = [];
});

describe("a connection of a kind the route does not know", () => {
    it("is never created, since no permission covers it", async () => {
        for (const type of ["Storage", "job", undefined]) {
            const response = await post({ name: "Sneaky", type, adapterId: "local-filesystem", config: { basePath: "/" } });
            expect(response.status).toBe(400);
        }
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.checked).toEqual([]);
    });

    it("is never listed", async () => {
        const response = await GET(new NextRequest("http://localhost/api/adapters?type=everything"));
        expect(response.status).toBe(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("leaves a known kind to its own permission", async () => {
        mocks.create.mockResolvedValue({ id: "new", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" });
        await post({ name: "NAS", type: "storage", adapterId: "local-filesystem", config: { basePath: "/" } });
        expect(mocks.checked).toEqual(["destinations:write"]);
        expect(mocks.create).toHaveBeenCalled();
    });
});
