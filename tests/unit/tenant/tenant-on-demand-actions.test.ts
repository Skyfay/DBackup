/**
 * The actions of backups on demand of a customer under Platform, Tenants: they need the platform
 * right on the tenants, reach only the tenants the viewer looks after, keep the number within the
 * limits and write the change into the log of the platform and of the tenants it concerns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";
import { effectiveOnDemand, onDemandSource } from "@/lib/tenant/sharing";

const P = PERMISSIONS;

type Viewer = { id: string; name: string; isPlatformAdmin: boolean; permissions: string[] };
const NINA: Viewer = { id: "nina", name: "Nina", isPlatformAdmin: false, permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    audit: vi.fn(),
    reaches: vi.fn(),
    service: { find: vi.fn(), set: vi.fn(), follow: vi.fn() },
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reaches: mocks.reaches } }));
vi.mock("@/services/tenant/tenant-on-demand", () => ({ tenantOnDemandService: mocks.service }));

const { followTenantOnDemand, getTenantOnDemand, setTenantOnDemand } = await import("@/app/actions/tenant/tenant-on-demand");

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = NINA;
    // Nina's platform group reaches Acme, not Globex.
    mocks.reaches.mockImplementation(async (_userId: string, tenantId: string) => tenantId === "acme");
    mocks.service.find.mockResolvedValue({ name: "Acme", perDay: 3, overrides: [] });
    mocks.service.set.mockResolvedValue({ name: "Acme", before: null, after: 3 });
    mocks.service.follow.mockResolvedValue({
        kind: "database", id: "a-1", sourceId: "srv-1", serverName: "Shared MySQL", providerId: "msp-2", providerName: "Skyfay Zurich", name: "shop", perDay: 0, tenantName: "Acme",
    });
});

describe("backups on demand of a customer", () => {
    it("need the platform right on the tenants, to see them and to change them", async () => {
        mocks.viewer = { ...NINA, permissions: [] };
        await expect(getTenantOnDemand("acme")).rejects.toThrow(PermissionError);
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.TENANTS_READ] };
        await expect(setTenantOnDemand("acme", 3)).rejects.toThrow(PermissionError);
        await expect(followTenantOnDemand("acme", "database", "a-1")).rejects.toThrow(PermissionError);
        expect(mocks.service.set).not.toHaveBeenCalled();
        expect(mocks.service.follow).not.toHaveBeenCalled();
    });

    it("reach only a tenant the platform group of the viewer looks after, another one reads as gone", async () => {
        expect(await getTenantOnDemand("globex")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(await setTenantOnDemand("globex", 3)).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(await followTenantOnDemand("globex", "rule", "r-1")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(mocks.service.find).not.toHaveBeenCalled();
        expect(await getTenantOnDemand("acme")).toEqual({ success: true, data: { name: "Acme", perDay: 3, overrides: [] } });
    });

    it("refuse a number out of the limits before the service sees it, and take none", async () => {
        expect(await setTenantOnDemand("acme", 25)).toEqual(expect.objectContaining({ success: false }));
        expect(await setTenantOnDemand("acme", 0)).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.service.set).not.toHaveBeenCalled();
        expect(await setTenantOnDemand("acme", null)).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.service.set).toHaveBeenCalledWith("acme", null);
    });

    it("write a change into the log of the platform and of the tenant", async () => {
        await setTenantOnDemand("acme", 3);
        const details = { name: "Acme", changes: [{ field: "Backups on demand", from: "Off", to: "3 a day" }] };
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", details, "acme", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", details, "acme", { tenantId: "acme" });
    });

    it("let a database follow the customer again, logged for the platform and for the tenant that shares the server", async () => {
        expect(await followTenantOnDemand("acme", "database", "a-1")).toEqual({ success: true });
        expect(mocks.service.follow).toHaveBeenCalledWith("acme", "database", "a-1");
        const details = expect.objectContaining({ change: "Backups on demand", tenant: "Acme", database: "shop", changes: [{ field: "Backups on demand", from: "Off here", to: "As the tenant" }] });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "ADAPTER", details, "srv-1", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "ADAPTER", details, "srv-1", { tenantId: "msp-2" });
    });
});

describe("the number of a database", () => {
    it("is its own, none when it is off there, else the number of its customer", () => {
        expect(effectiveOnDemand(5, 3)).toBe(5);
        expect(effectiveOnDemand(0, 3)).toBeNull();
        expect(effectiveOnDemand(null, 3)).toBe(3);
        expect(effectiveOnDemand(null, null)).toBeNull();
        expect([onDemandSource(null), onDemandSource(0), onDemandSource(2)]).toEqual(["tenant", "off", "own"]);
    });
});
