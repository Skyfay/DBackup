// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    tenants: [] as { id: string; name: string }[],
    update: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// Acme and Globex, found by id or by their unique name.
vi.mock("@/lib/prisma", () => ({
    default: {
        tenant: {
            findUnique: vi.fn(async ({ where }: { where: { id?: string; name?: string } }) =>
                mocks.tenants.find((tenant) => tenant.id === where.id || tenant.name === where.name) ?? null),
            update: (...args: unknown[]) => mocks.update(...args),
        },
    },
}));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { tenantService, TENANT_NAME_REFUSED } = await import("@/services/tenant/tenant-service");

describe("renaming a tenant to a name another tenant has", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tenants = [{ id: "acme", name: "Acme" }, { id: "globex", name: "Globex" }];
    });

    it("never tells a tenant that renames itself that another tenant has the name", async () => {
        const refusal = await tenantService.rename("acme", "Globex", { ownTenant: true }).catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ValidationError);
        expect((refusal as Error).message).toBe(TENANT_NAME_REFUSED);
        expect((refusal as Error).message).not.toMatch(/Globex|exists|tenant named/i);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it("tells the platform which name is taken", async () => {
        await expect(tenantService.rename("acme", "Globex")).rejects.toBeInstanceOf(ConflictError);
        await expect(tenantService.rename("acme", "Globex")).rejects.toThrow('A tenant named "Globex" exists already.');
    });

    it("renames a tenant to a free name or to its own", async () => {
        expect(await tenantService.rename("acme", "Acme AG", { ownTenant: true })).toEqual({ name: "Acme AG", renamedFrom: "Acme" });
        expect(await tenantService.rename("acme", "Acme", { ownTenant: true })).toEqual({ name: "Acme", renamedFrom: "Acme" });
    });
});
