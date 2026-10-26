import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        user: { findUnique: vi.fn() },
        tenantMembership: { findMany: vi.fn() },
    },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

const { groupsBeyondViewer } = await import("@/services/user/account-groups-beyond");

const ADMIN = { permissions: "[]", fullAccess: true };
const VIEWERS = { permissions: '["jobs:read"]', fullAccess: false };
const OPERATORS = { permissions: '["users:read","users:write","jobs:read","jobs:execute"]', fullAccess: false };

describe("the accounts a list of users locks for a viewer by their groups", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Ops operates Acme and holds no platform group.
        mocks.prisma.user.findUnique.mockResolvedValue({ platformRole: null, memberships: [{ tenantId: "acme", group: OPERATORS }], platformGroup: null });
        mocks.prisma.tenantMembership.findMany.mockResolvedValue([
            { userId: "anna", tenantId: "acme", group: ADMIN },
            { userId: "vic", tenantId: "acme", group: VIEWERS },
            // A tenant Ops does not work in, where they may do nothing.
            { userId: "gina", tenantId: "globex", group: VIEWERS },
        ]);
    });

    it("locks the Admin of the tenant and an account of a tenant where the viewer may do nothing, never a weaker one", async () => {
        expect([...(await groupsBeyondViewer("ops", ["anna", "vic", "gina", "ops"]))].sort()).toEqual(["anna", "gina"]);
        expect(mocks.prisma.tenantMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["anna", "vic", "gina"] } } }));
    });

    it("locks nothing for a platform admin", async () => {
        mocks.prisma.user.findUnique.mockResolvedValue({ platformRole: "ADMIN", memberships: [], platformGroup: null });
        expect((await groupsBeyondViewer("root", ["anna", "vic"])).size).toBe(0);
    });
});
