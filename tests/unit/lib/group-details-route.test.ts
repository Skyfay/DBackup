/**
 * The history of one group, `GET /api/groups/{id}`: it needs the right to see the groups, and in
 * All tenants, where the group may be of any tenant, the right to see the accounts of the platform,
 * like the panel of a user there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getGroupDetails: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/user/group-details", () => ({ getGroupDetails: (...args: unknown[]) => mocks.getGroupDetails(...args) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { GET } = await import("@/app/api/groups/[id]/route");

const openGroup = (id: string) => GET(new NextRequest(`http://localhost/api/groups/${id}`), { params: Promise.resolve({ id }) });
const context = (permissions: string[], allTenants = false) => ({ userId: "nina", permissions, isPlatformAdmin: false, authMethod: "session", tenantId: allTenants ? null : "acme", allTenants });

describe("GET /api/groups/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getGroupDetails.mockResolvedValue({ id: "g-ops", events: [] });
    });

    it("answers with the history of a group of the tenant to whoever may see the groups", async () => {
        mocks.getAuthContext.mockResolvedValue(context([PERMISSIONS.GROUPS.READ]));
        expect(await (await openGroup("g-ops")).json()).toEqual({ success: true, data: { id: "g-ops", events: [] } });
    });

    it("needs the right to see the accounts of the platform in All tenants, before it loads anything", async () => {
        mocks.getAuthContext.mockResolvedValue(context([PERMISSIONS.GROUPS.READ], true));
        expect((await openGroup("g-ops")).status).toBe(403);
        expect(mocks.getGroupDetails).not.toHaveBeenCalled();

        mocks.getAuthContext.mockResolvedValue(context([PERMISSIONS.GROUPS.READ, PERMISSIONS.PLATFORM.ACCOUNTS_READ], true));
        expect((await openGroup("g-ops")).status).toBe(200);
    });
});
