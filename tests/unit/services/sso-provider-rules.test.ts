// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { domainOfEmail, emailOfDomain, isEmailDomain, normalizeDomain } from "@/lib/auth/sso-domain";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { belongsTo, settlePlacement } = await import("@/services/sso/sso-provider-rules");
type Lookups = NonNullable<Parameters<typeof settlePlacement>[2]>;

const GROUPS: Record<string, { id: string; name: string; tenantId: string }> = {
    "g-ops": { id: "g-ops", name: "Operators", tenantId: "default" },
    "g-acme": { id: "g-acme", name: "Viewer", tenantId: "acme" },
};

const lookups = (claimed: { name: string; domain: string; id: string }[] = []): Lookups => ({
    tenantName: async (id) => ({ default: "Skyfay Hosting", acme: "Acme GmbH" } as Record<string, string>)[id] ?? null,
    group: async (id, tenantId) => (GROUPS[id]?.tenantId === tenantId ? GROUPS[id] : null),
    domainOwner: async (domain, exceptId) => claimed.find((entry) => entry.domain === domain && entry.id !== exceptId) ?? null,
});

const placement = (fields: Partial<Parameters<typeof settlePlacement>[0]> = {}) => ({ tenantId: null, domain: null, allowProvisioning: true, defaultGroupId: "g-ops", ...fields });

describe("where a sign-in provider belongs", () => {
    it("reads an email domain the same way in the form and on the server", () => {
        expect(normalizeDomain("  @Acme.CH ")).toBe("acme.ch");
        expect(normalizeDomain(" ")).toBeNull();
        expect(["acme.ch", "mail.acme.co.uk", "xn--bcher-kva.ch"].every(isEmailDomain)).toBe(true);
        expect(["acme", "lena@acme.ch", "https://acme.ch", "acme.ch/", "-acme.ch", "10.0.0.1"].some(isEmailDomain)).toBe(false);
        expect(domainOfEmail("Lena.Graf@ACME.ch")).toBe("acme.ch");
        expect(emailOfDomain("lena@acme.ch", "ACME.ch")).toBe(true);
        expect(emailOfDomain("lena@mail.acme.ch", "acme.ch")).toBe(false);
        expect(emailOfDomain("acme.ch", "acme.ch")).toBe(false);
    });

    it("counts the home tenant as the platform", () => {
        expect([belongsTo("default"), belongsTo(""), belongsTo(null), belongsTo("acme")]).toEqual([null, null, null, "acme"]);
    });

    it("keeps a provider of the platform as before: a button, the domain optional, a group of the home tenant", async () => {
        expect(await settlePlacement(placement(), null, lookups())).toEqual({ ok: true, placement: placement(), tenantName: null });
        expect(await settlePlacement(placement({ defaultGroupId: "g-acme" }), null, lookups())).toEqual({ ok: false, error: "The group no longer exists." });
    });

    it("asks a provider of a tenant for its domain and for a group of that tenant", async () => {
        const acme = placement({ tenantId: "acme", domain: "Acme.ch", defaultGroupId: "g-acme" });

        expect(await settlePlacement(acme, null, lookups())).toEqual({ ok: true, placement: { ...acme, domain: "acme.ch" }, tenantName: "Acme GmbH" });
        expect(await settlePlacement({ ...acme, domain: null }, null, lookups())).toMatchObject({ ok: false, error: "A provider of a tenant is reached by its email domain only, so it needs one." });
        expect(await settlePlacement({ ...acme, defaultGroupId: "g-ops" }, null, lookups())).toMatchObject({ ok: false, error: "The group is no group of Acme GmbH. Pick one of its groups." });
        expect(await settlePlacement({ ...acme, defaultGroupId: null }, null, lookups())).toMatchObject({ ok: false, error: "A provider of a tenant adds people to Acme GmbH, so it needs a group there for them." });
    });

    it("lets a provider of a tenant that adds nobody go without a group, and drops one that no longer fits", async () => {
        const quiet = placement({ tenantId: "acme", domain: "acme.ch", allowProvisioning: false, defaultGroupId: "g-ops" });

        expect(await settlePlacement(quiet, { id: "sso-1", ...placement() }, lookups())).toEqual({ ok: true, placement: { ...quiet, defaultGroupId: null }, tenantName: "Acme GmbH" });
    });

    it("gives every domain to one provider, the provider itself left out", async () => {
        const claimed = [{ id: "sso-1", name: "Authentik", domain: "acme.ch" }];
        const acme = placement({ tenantId: "acme", domain: "acme.ch", defaultGroupId: "g-acme" });

        expect(await settlePlacement(acme, null, lookups(claimed))).toMatchObject({ ok: false, error: "Authentik signs in acme.ch already. A domain belongs to one provider." });
        expect(await settlePlacement(acme, { id: "sso-1", ...acme }, lookups(claimed))).toMatchObject({ ok: true });
    });

    it("refuses a tenant that is gone", async () => {
        expect(await settlePlacement(placement({ tenantId: "gone", domain: "gone.ch" }), null, lookups())).toEqual({ ok: false, error: "The tenant no longer exists." });
    });
});
