/**
 * The action of the Network part of a tenant under Platform, Tenants: it needs the platform right on
 * the tenants, reaches only the tenants the viewer looks after, never the home tenant nor All
 * tenants, and writes what changed into the log of the platform and of the tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, ValidationError } from "@/lib/logging/errors";

const P = PERMISSIONS;

type Viewer = { id: string; isPlatformAdmin: boolean; tenantId: string | null; allTenants: boolean; permissions: string[] };
const NINA: Viewer = { id: "nina", isPlatformAdmin: false, tenantId: "default", allTenants: false, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    audit: vi.fn(),
    reaches: vi.fn(),
    setNetwork: vi.fn(),
}));

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
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: {} }));
vi.mock("@/services/tenant/tenant-summaries", () => ({ tenantSummaries: vi.fn() }));
vi.mock("@/services/tenant/tenant-contents", () => ({ tenantContents: vi.fn(), isEmptyTenant: vi.fn() }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reaches: mocks.reaches, reachesAll: vi.fn() } }));
vi.mock("@/services/tenant/tenant-network", () => ({ setNetwork: mocks.setNetwork }));

const { setTenantNetwork } = await import("@/app/actions/tenant/tenant");

const BLOCKED = { blocks: true, allowed: ["10.10.10.0/24"] };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = NINA;
    // Nina's platform group reaches Acme, not Globex.
    mocks.reaches.mockImplementation(async (_userId: string, tenantId: string) => tenantId === "acme");
    mocks.setNetwork.mockResolvedValue({ name: "Acme", before: { blocks: false, allowed: [] }, after: BLOCKED });
});

describe("the network of a tenant", () => {
    it("needs the right to change the tenants", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.TENANTS_READ] };
        await expect(setTenantNetwork("acme", BLOCKED)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.setNetwork).not.toHaveBeenCalled();
    });

    it("changes only a tenant the platform group of the viewer reaches, another one reads as gone", async () => {
        expect(await setTenantNetwork("globex", BLOCKED)).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(mocks.setNetwork).not.toHaveBeenCalled();
    });

    it("never changes the home tenant, which is the platform, nor All tenants, which is no tenant", async () => {
        mocks.viewer = { ...NINA, isPlatformAdmin: true };
        expect(await setTenantNetwork("default", BLOCKED)).toEqual({ success: false, error: "The home tenant is the platform and reaches the network of its server." });
        expect(await setTenantNetwork("*", BLOCKED)).toEqual({ success: false, error: "All tenants is no tenant of its own. Pick the tenant to change." });
        expect(mocks.setNetwork).not.toHaveBeenCalled();
    });

    it("refuses a request that is no setting of the network", async () => {
        expect(await setTenantNetwork("acme", { blocks: "yes", allowed: [] } as never)).toEqual(expect.objectContaining({ success: false }));
        expect(await setTenantNetwork("acme", { blocks: true, allowed: Array.from({ length: 51 }, (_, index) => `10.0.${index}.0/24`) })).toEqual({
            success: false,
            error: "A tenant has at most 50 allowed ranges. Allow a wider range instead.",
        });
        expect(mocks.setNetwork).not.toHaveBeenCalled();
    });

    it("saves for a viewer who reaches the tenant and writes what changed into the log of the platform and of the tenant", async () => {
        expect(await setTenantNetwork("acme", BLOCKED)).toEqual({ success: true });
        expect(mocks.setNetwork).toHaveBeenCalledWith("acme", BLOCKED);

        const changes = [
            { field: "Local network", from: "Reached", to: "Blocked" },
            { field: "Allowed ranges", from: null, to: "10.10.10.0/24" },
        ];
        expect(mocks.audit).toHaveBeenCalledTimes(2);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", { name: "Acme", changes }, "acme", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", { name: "Acme", changes }, "acme", { tenantId: "acme" });
    });

    it("writes nothing into the log when nothing changed, the ranges in another order included", async () => {
        mocks.setNetwork.mockResolvedValue({ name: "Acme", before: { blocks: true, allowed: ["a", "b"] }, after: { blocks: true, allowed: ["b", "a"] } });
        expect(await setTenantNetwork("acme", { blocks: true, allowed: [] })).toEqual({ success: true });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("says why the service refused, like a range that does not read", async () => {
        mocks.setNetwork.mockRejectedValue(new ValidationError("10.10.10.5/24 has bits set after its prefix. Did you mean 10.10.10.0/24?"));
        expect(await setTenantNetwork("acme", { blocks: true, allowed: ["10.10.10.5/24"] })).toEqual({ success: false, error: "10.10.10.5/24 has bits set after its prefix. Did you mean 10.10.10.0/24?" });
        expect(mocks.audit).not.toHaveBeenCalled();
    });
});
