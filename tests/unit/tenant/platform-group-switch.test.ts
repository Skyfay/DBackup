import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/logging/errors";

const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
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
    db.tenant.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ name: where.id === "acme" ? "Acme GmbH" : "Praxis" }));
    db.tenantMembership.findUnique.mockResolvedValue(null);
});

describe("switching into a tenant through a platform group", () => {
    it("opens a tenant of the scope without a membership there", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group() });

        expect(await tenantService.setActive("s1", "lena", "acme", false)).toEqual({ name: "Acme GmbH" });
        expect(db.session.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { activeTenantId: "acme" } });
    });

    it("keeps a tenant out of the scope closed, as if it did not exist", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group() });

        await expect(tenantService.setActive("s1", "lena", "praxis", false)).rejects.toBeInstanceOf(NotFoundError);
        expect(db.session.update).not.toHaveBeenCalled();
    });

    it("opens All tenants only for a group that reaches every tenant and sees something there", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: group({ allTenants: true, tenants: [] }) });
        expect(await tenantService.setActive("s1", "lena", "*", false)).toEqual({ name: "All tenants" });

        db.user.findUnique.mockResolvedValue({ platformGroup: group() });
        await expect(tenantService.setActive("s1", "lena", "*", false)).rejects.toBeInstanceOf(NotFoundError);

        db.user.findUnique.mockResolvedValue({ platformGroup: group({ allTenants: true, tenants: [], tenantPermissions: [] }) });
        await expect(tenantService.setActive("s1", "lena", "*", false)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("still opens the tenants of the own memberships without a platform group", async () => {
        db.user.findUnique.mockResolvedValue({ platformGroup: null });
        db.tenantMembership.findUnique.mockResolvedValue({ tenantId: "praxis" });

        expect(await tenantService.setActive("s1", "eva", "praxis", false)).toEqual({ name: "Praxis" });
    });
});
