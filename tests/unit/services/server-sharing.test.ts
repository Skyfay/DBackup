import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({ count: vi.fn(), find: vi.fn(), sharing: new Set<string>() }));

// Whether a tenant shares databases, which the platform switches on per tenant.
vi.mock("@/lib/prisma", () => ({
    default: { tenant: { findUnique: async ({ where }: { where: { id: string } }) => ({ sharesWithCustomers: mocks.sharing.has(where.id) }) } },
}));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { count: mocks.count, find: mocks.find } }));

const { serverSharingOf } = await import("@/services/tenant/server-sharing");

/** The card Shared with tenants on the page of a database connection, like on the page of its server. */
describe("when a database connection offers its databases to other tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.count.mockResolvedValue(3);
        mocks.sharing = new Set([HOME_TENANT_ID, "msp-two"]);
        mocks.find.mockImplementation(async (id: string) => ({ id, name: id === HOME_TENANT_ID ? "Skyfay" : "Acme GmbH" }));
    });

    it("shows the card in the home tenant while there is another tenant, with the right to assign as given", async () => {
        expect(await serverSharingOf(HOME_TENANT_ID, { see: true, assign: true })).toEqual({ tenantName: "Skyfay", canAssign: true });
        expect(await serverSharingOf(HOME_TENANT_ID, { see: true, assign: false })).toEqual({ tenantName: "Skyfay", canAssign: false });
    });

    it("leaves the card out for someone who may not see the shared databases, whatever they may do with the server", async () => {
        expect(await serverSharingOf(HOME_TENANT_ID, { see: false, assign: false })).toBeNull();
        expect(mocks.count).not.toHaveBeenCalled();
    });

    it("never shows it to a customer, who keeps their servers and never learns the other tenants", async () => {
        expect(await serverSharingOf("tenant-a", { see: true, assign: true })).toBeNull();
        expect(mocks.count).not.toHaveBeenCalled();
    });

    it("shows it in every tenant the platform lets share databases", async () => {
        expect(await serverSharingOf("msp-two", { see: true, assign: true })).toEqual({ tenantName: "Acme GmbH", canAssign: true });
    });

    it("never shows it in All tenants, where giving a database away would change a tenant", async () => {
        expect(await serverSharingOf(null, { see: true, assign: true })).toBeNull();
    });

    it("leaves it out while the home tenant is the only one, like on every install with one tenant", async () => {
        mocks.count.mockResolvedValue(1);
        expect(await serverSharingOf(HOME_TENANT_ID, { see: true, assign: true })).toBeNull();
    });
});
