import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/logging/errors";

const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    tenantMembership: { findUnique: vi.fn() },
    session: { update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { tenantService } = await import("@/services/tenant/tenant-service");

/** A platform group of the MSP as the session reads it. */
const group = (over: Partial<{ tenantPermissions: string[]; allTenants: boolean; tenants: { tenantId: string }[] }> = {}) => ({
    platformPermissions: "[]",
    tenantPermissions: JSON.stringify(over.tenantPermissions ?? ["jobs:read"]),
    allTenants: over.allTenants ?? false,
    tenants: over.tenants ?? [{ tenantId: "acme" }],
});

beforeEach(() => {
    vi.clearAllMocks();
    db.tenant.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ name: where.id === "acme" ? "Acme GmbH" : where.id === "default" ? "Skyfay" : "Praxis" }));
    db.tenant.count.mockResolvedValue(3);
    db.tenantMembership.findUnique.mockResolvedValue(null);
});

describe("switching into a tenant through a platform group", () => {
    it("opens a tenant of the scope without a membership there", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group() });

        expect(await tenantService.setActive("s1", "lena", "acme", false)).toEqual({ id: "acme", name: "Acme GmbH" });
        expect(db.session.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { activeTenantId: "acme" } });
    });

    it("keeps a tenant out of the scope closed, as if it did not exist", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group() });

        await expect(tenantService.setActive("s1", "lena", "praxis", false)).rejects.toBeInstanceOf(NotFoundError);
        expect(db.session.update).not.toHaveBeenCalled();
    });

    it("opens All tenants only for a group that reaches every tenant and sees something there", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group({ allTenants: true, tenants: [] }) });
        expect(await tenantService.setActive("s1", "lena", "*", false)).toEqual({ id: "*", name: "All tenants" });

        db.user.findUnique.mockResolvedValue({ platformGroup: group() });
        await expect(tenantService.setActive("s1", "lena", "*", false)).rejects.toBeInstanceOf(NotFoundError);

        db.user.findUnique.mockResolvedValue({ platformGroup: group({ allTenants: true, tenants: [], tenantPermissions: [] }) });
        await expect(tenantService.setActive("s1", "lena", "*", false)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("still opens the tenants of the own memberships without a platform group", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: null });
        db.tenantMembership.findUnique.mockResolvedValue({ tenantId: "praxis" });

        expect(await tenantService.setActive("s1", "eva", "praxis", false)).toEqual({ id: "praxis", name: "Praxis" });
    });
});

describe("switching into a tenant that changed meanwhile", () => {
    it("says in a plain sentence that a tenant deleted meanwhile is gone, without its id", async () => {
        db.tenant.findUnique.mockResolvedValue(null);

        const refused = tenantService.setActive("s1", "root", "cmtenant42", true);
        await expect(refused).rejects.toBeInstanceOf(NotFoundError);
        await expect(refused).rejects.toThrow("The tenant no longer exists, or you may not open it.");
        expect(db.session.update).not.toHaveBeenCalled();
    });

    it("puts the session into the home tenant when All tenants is picked with one tenant left, and says so", async () => {
        db.tenant.count.mockResolvedValue(1);

        expect(await tenantService.setActive("s1", "root", "*", true)).toEqual({ id: "default", name: "Skyfay" });
        expect(db.session.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { activeTenantId: "default" } });

        db.user.findUnique.mockResolvedValue({ platformGroup: group({ allTenants: true, tenants: [] }) });
        expect(await tenantService.setActive("s2", "lena", "*", false)).toEqual({ id: "default", name: "Skyfay" });
    });
});

describe("the tenants someone may switch to", () => {
    const FULL = { permissions: "[]", fullAccess: true };
    const VIEWER = { permissions: JSON.stringify(["jobs:read", "sources:read"]), fullAccess: false };

    beforeEach(() => {
        db.tenant.findMany.mockResolvedValue([
            { id: "acme", name: "Acme GmbH", logo: null },
            { id: "default", name: "Skyfay", logo: null },
            { id: "praxis", name: "Praxis", logo: null },
        ]);
    });

    it("names what someone may change in each tenant, from the group there and the platform group", async () => {
        db.user.findUnique.mockResolvedValue({
            memberships: [{ tenantId: "default", group: FULL }, { tenantId: "praxis", group: VIEWER }],
            platformGroup: group({ allTenants: true, tenants: [], tenantPermissions: ["jobs:read", "jobs:write"] }),
        });

        const tenants = await tenantService.switchable("lena", false);
        const writes = Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.writes]));

        expect(tenants.map((tenant) => tenant.id)).toEqual(["default", "acme", "praxis"]);
        expect(writes.default).toEqual(expect.arrayContaining(["jobs:write", "sources:write", "destinations:write"]));
        expect(writes.acme).toEqual(["jobs:write"]);
        expect(writes.praxis).toEqual(["jobs:write"]);
        // The settings of the instance and the rights of the platform are no records of a tenant.
        expect(writes.default).not.toContain("settings:write");
    });

    it("leaves the rights out for a platform admin, who may change everything everywhere", async () => {
        const tenants = await tenantService.switchable("root", true);

        expect(tenants.every((tenant) => tenant.writes === undefined)).toBe(true);
        expect(db.user.findUnique).not.toHaveBeenCalled();
    });
});
