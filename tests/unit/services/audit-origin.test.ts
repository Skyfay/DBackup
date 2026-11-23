import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { originShown } = await import("@/services/audit/audit-rows");

const person = (tenantIds: string[]) => ({ name: "Tom", image: null, platformRole: null, memberships: tenantIds.map((tenantId) => ({ tenantId, group: { name: "Admins" } })) });

describe("where an entry of the audit log came from", () => {
    it("shows the address and browser of a member of the tenant, and every entry of the home tenant", () => {
        expect(originShown({ tenantId: "acme", userId: "u1", actorName: "Tom", user: person(["acme"]) })).toBe(true);
        expect(originShown({ tenantId: "default", userId: "u1", actorName: "Tom", user: person([]) })).toBe(true);
    });

    it("shows them for an entry of no person, like a failed sign-in", () => {
        expect(originShown({ tenantId: "acme", userId: null, actorName: null, user: null })).toBe(true);
    });

    it("keeps them of someone of the platform who works in a customer's tenant without being a member", () => {
        expect(originShown({ tenantId: "acme", userId: "u1", actorName: "Tom", user: person(["default"]) })).toBe(false);
        expect(originShown({ tenantId: "acme", userId: "u1", actorName: "Tom", user: person([]) })).toBe(false);
    });

    it("keeps them of a deleted account in a customer's log, whose memberships are gone, and shows them at home", () => {
        // Nina of the platform worked in Acme, then her account was deleted and the entry kept only her name.
        expect(originShown({ tenantId: "acme", userId: null, actorName: "Nina", user: null })).toBe(false);
        expect(originShown({ tenantId: "default", userId: null, actorName: "Nina", user: null })).toBe(true);
    });
});

describe("where an entry of the home tenant came from, for a platform group of some tenants", () => {
    const view = { reach: ["acme"], viewerId: "nina", key: "reach:nina:acme" };

    it("shows the address and browser of an account it reaches, its own and an entry of no person", () => {
        expect(originShown({ tenantId: "default", userId: "u1", actorName: "Tom", user: person(["acme"]) }, view)).toBe(true);
        expect(originShown({ tenantId: "default", userId: "nina", actorName: "Nina", user: person([]) }, view)).toBe(true);
        expect(originShown({ tenantId: "default", userId: null, actorName: null, user: null }, view)).toBe(true);
    });

    it("keeps them of an account of another tenant, of no tenant beyond the home tenant and of a deleted one", () => {
        expect(originShown({ tenantId: "default", userId: "u2", actorName: "Gus", user: person(["globex"]) }, view)).toBe(false);
        expect(originShown({ tenantId: "default", userId: "u3", actorName: "Lone", user: person([]) }, view)).toBe(false);
        expect(originShown({ tenantId: "default", userId: null, actorName: "Tom", user: null }, view)).toBe(false);
    });
});
