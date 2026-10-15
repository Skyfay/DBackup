import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

const db = vi.hoisted(() => ({
    tenant: { count: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    platformGroup: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

const { platformPeopleOf } = await import("@/services/user/platform-people");

const person = (id: string, name: string) => ({ id, name, email: `${id}@skyfay.ch`, image: null });

beforeEach(() => {
    vi.clearAllMocks();
    db.tenant.count.mockResolvedValue(3);
    db.tenant.findUnique.mockResolvedValue({ name: "Skyfay Hosting" });
    db.user.findMany.mockResolvedValue([person("root", "Manu")]);
    db.platformGroup.findMany.mockResolvedValue([
        { id: "pg-support", name: "Support", tenantPermissions: JSON.stringify([PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE]), members: [person("lena", "Lena Graf")] },
        { id: "pg-empty", name: "Billing", tenantPermissions: "[]", members: [] },
    ]);
});

describe("who of the MSP opens a tenant through the platform", () => {
    it("lists the platform admins first, then each platform group that reaches the tenant with someone in it", async () => {
        expect(await platformPeopleOf("acme")).toEqual({
            home: "Skyfay Hosting",
            groups: [
                { id: "platform-admin", name: "Platform admin", builtIn: true, line: "Everything", members: [person("root", "Manu")] },
                { id: "pg-support", name: "Support", builtIn: false, line: "Runs jobs, changes nothing", members: [person("lena", "Lena Graf")] },
            ],
        });
        // Only the groups whose scope reaches the tenant, every tenant or this one among theirs.
        expect(db.platformGroup.findMany.mock.calls[0][0].where).toEqual({ OR: [{ allTenants: true }, { tenants: { some: { tenantId: "acme" } } }] });
    });

    it("lists nobody while the instance has one tenant", async () => {
        db.tenant.count.mockResolvedValue(1);
        expect((await platformPeopleOf("default")).groups).toEqual([]);
    });
});
