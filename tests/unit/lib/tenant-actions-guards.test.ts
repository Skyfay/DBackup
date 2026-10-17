import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

type Viewer = { id: string; isPlatformAdmin: boolean; tenantId: string | null; permissions: string[] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    tenants: { switchable: vi.fn(), create: vi.fn(), rename: vi.fn(), delete: vi.fn() },
    platformGroups: { reaches: vi.fn(), reachesAll: vi.fn() },
    summaries: vi.fn(),
    audit: vi.fn(),
    contents: vi.fn(),
}));

// The real check, reduced to the permissions of the viewer, which a platform admin passes.
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    currentSessionId: vi.fn(),
    forgetAuthContext: vi.fn(),
    getViewer: vi.fn(async () => mocks.viewer),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: mocks.tenants }));
vi.mock("@/services/tenant/tenant-summaries", () => ({ tenantSummaries: mocks.summaries }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: mocks.platformGroups }));
vi.mock("@/services/tenant/tenant-contents", () => ({
    tenantContents: mocks.contents,
    isEmptyTenant: (contents: { connections: number; jobs: number; members: number }) => contents.connections + contents.jobs + contents.members === 0,
}));

const { bulkDeleteTenants, createTenant, deleteTenant, getTenantSummaries, renameTenant } = await import("@/app/actions/tenant/tenant");

const P = PERMISSIONS;
/** Someone of a platform group of Acme and Shop that sees the tenants. */
const SUPPORT: Viewer = { id: "nina", isPlatformAdmin: false, tenantId: "default", permissions: [P.PLATFORM.TENANTS_READ] };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = SUPPORT;
    mocks.tenants.switchable.mockResolvedValue([{ id: "acme", name: "Acme GmbH" }, { id: "shop", name: "Shop" }]);
    // The platform group reaches every tenant, Acme and Shop among the ones it may open.
    mocks.platformGroups.reaches.mockImplementation(async (_userId: string, tenantId: string) => ["acme", "shop"].includes(tenantId));
    mocks.platformGroups.reachesAll.mockResolvedValue(true);
    mocks.summaries.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, jobs: 1, databases: 2, health: null })));
    mocks.tenants.create.mockResolvedValue({ id: "new", name: "New" });
    mocks.tenants.rename.mockResolvedValue({ name: "Acme AG", renamedFrom: "Acme GmbH" });
    mocks.tenants.delete.mockResolvedValue({ name: "Acme GmbH", connections: 0, jobs: 0, runs: 0, keys: 0 });
});

describe("the tenants through a platform group", () => {
    it("shows the numbers of the tenants the group may open to whoever may see the tenants", async () => {
        expect(await getTenantSummaries()).toEqual({ success: true, data: [expect.objectContaining({ id: "acme" }), expect.objectContaining({ id: "shop" })] });
        expect(mocks.tenants.switchable).toHaveBeenCalledWith("nina", false);
    });

    it("refuses the numbers to someone who may not see the tenants", async () => {
        mocks.viewer = { ...SUPPORT, permissions: [P.SETTINGS.READ] };
        await expect(getTenantSummaries()).rejects.toBeInstanceOf(PermissionError);
    });

    it("creates, renames and deletes nothing for someone who may only see the tenants", async () => {
        await expect(createTenant("New")).rejects.toBeInstanceOf(PermissionError);
        await expect(renameTenant("acme", "Acme AG")).rejects.toBeInstanceOf(PermissionError);
        await expect(deleteTenant("acme")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.tenants.create).not.toHaveBeenCalled();
        expect(mocks.tenants.rename).not.toHaveBeenCalled();
        expect(mocks.tenants.delete).not.toHaveBeenCalled();
    });

    it("lets a group that may change tenants create one and rename one it reaches, into the log of the home tenant", async () => {
        mocks.viewer = { ...SUPPORT, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };

        expect(await createTenant("New")).toEqual({ success: true, data: { id: "new", name: "New" } });
        expect(await renameTenant("acme", "Acme AG")).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", { name: "Acme AG", renamedFrom: "Acme GmbH" }, "acme", { tenantId: "default" });
    });

    it("never renames or deletes a tenant out of the group's reach, which reads as gone", async () => {
        mocks.viewer = { ...SUPPORT, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };

        expect(await renameTenant("praxis", "Praxis AG")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(await deleteTenant("praxis")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(mocks.tenants.rename).not.toHaveBeenCalled();
        expect(mocks.tenants.delete).not.toHaveBeenCalled();
    });

    it("creates no tenant for a group of some tenants, and manages no tenant through a membership alone", async () => {
        mocks.viewer = { ...SUPPORT, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };
        mocks.platformGroups.reachesAll.mockResolvedValue(false);
        expect(await createTenant("New")).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.tenants.create).not.toHaveBeenCalled();

        // Shop is a tenant the person is a member of, out of the reach of the platform group.
        mocks.platformGroups.reaches.mockImplementation(async (_userId: string, tenantId: string) => tenantId === "acme");
        expect(await deleteTenant("shop")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(mocks.tenants.delete).not.toHaveBeenCalled();
    });

    it("lets a platform admin manage every tenant", async () => {
        mocks.viewer = { id: "root", isPlatformAdmin: true, tenantId: "default", permissions: [] };
        expect(await deleteTenant("praxis")).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.tenants.switchable).not.toHaveBeenCalled();
    });
});

describe("deleting several tenants at once", () => {
    beforeEach(() => {
        mocks.viewer = { ...SUPPORT, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };
        mocks.contents.mockImplementation(async (id: string) => (id === "shop" ? { connections: 2, jobs: 1, members: 3 } : { connections: 0, jobs: 0, members: 0 }));
    });

    it("needs the right to change the tenants", async () => {
        mocks.viewer = SUPPORT;
        await expect(bulkDeleteTenants(["acme"])).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.tenants.delete).not.toHaveBeenCalled();
    });

    it("deletes only empty tenants the viewer looks after, never the one they work in, and says why of the others", async () => {
        const result = await bulkDeleteTenants(["acme", "shop", "praxis", "default"]);

        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["acme"],
                failed: [
                    { id: "shop", error: expect.stringMatching(/holds connections, jobs or people/) },
                    { id: "praxis", error: "The tenant no longer exists." },
                    { id: "default", error: "You work in this tenant. Open another one first." },
                ],
            },
        });
        expect(mocks.tenants.delete).toHaveBeenCalledTimes(1);
        expect(mocks.tenants.delete).toHaveBeenCalledWith("acme");
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "TENANT", expect.objectContaining({ name: "Acme GmbH" }), "acme", { tenantId: "default" });
    });
});
