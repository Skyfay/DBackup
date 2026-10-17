import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { originShown } = await import("@/services/audit/audit-rows");

const person = (tenantIds: string[]) => ({ name: "Tom", image: null, platformRole: null, memberships: tenantIds.map((tenantId) => ({ tenantId, group: { name: "Admins" } })) });

describe("where an entry of the audit log came from", () => {
    it("shows the address and browser of a member of the tenant, and every entry of the home tenant", () => {
        expect(originShown({ tenantId: "acme", userId: "u1", user: person(["acme"]) })).toBe(true);
        expect(originShown({ tenantId: "default", userId: "u1", user: person([]) })).toBe(true);
        expect(originShown({ tenantId: "acme", userId: null, user: null })).toBe(true);
    });

    it("keeps them of someone of the platform who works in a customer's tenant without being a member", () => {
        expect(originShown({ tenantId: "acme", userId: "u1", user: person(["default"]) })).toBe(false);
        expect(originShown({ tenantId: "acme", userId: "u1", user: person([]) })).toBe(false);
    });
});
