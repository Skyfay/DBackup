// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { membersOfAny } = await import("@/services/tenant/membership-service");

describe("the accounts a platform group of some tenants sees", () => {
    it("are the people of its tenants", () => {
        expect(membersOfAny(["acme"])).toEqual({ memberships: { some: { tenantId: { in: ["acme"] } } } });
    });

    it("count an account in no tenant as one of the home tenant, like a change of it does", () => {
        expect(membersOfAny(["default", "acme"])).toEqual({
            OR: [{ memberships: { some: { tenantId: { in: ["default", "acme"] } } } }, { memberships: { none: {} } }],
        });
    });
});
