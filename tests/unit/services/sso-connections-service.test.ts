import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));

const { listSsoConnections, prepareSsoConnect } = await import("@/services/sso/sso-connections-service");

const AUTHENTIK = { providerId: "authentik", name: "Authentik", adapterId: "authentik", enabled: true, tenantId: null, domain: null };
const ACME = { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", enabled: true, tenantId: "acme", domain: "acme.ch" };
const GLOBEX = { providerId: "okta-globex", name: "Globex Okta", adapterId: "generic", enabled: true, tenantId: "globex", domain: "globex.ch" };

const user = (email: string, tenants: string[], platformRole: string | null = null) => ({ email, platformRole, memberships: tenants.map((tenantId) => ({ tenantId })) });

describe("the providers someone can connect on their profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.account.findMany.mockResolvedValue([]);
        prismaMock.ssoProvider.findMany.mockResolvedValue([AUTHENTIK, ACME, GLOBEX] as never);
    });

    it("offers the providers of the platform and of their own tenants only, by an email of the domain", async () => {
        prismaMock.user.findUnique.mockResolvedValue(user("lena@acme.ch", ["acme"]) as never);

        const { connectableProviders } = await listSsoConnections("lena");

        expect(connectableProviders.map((provider) => provider.providerId)).toEqual(["authentik", "entra-acme"]);
    });

    it("never offers a tenant's provider to a platform admin, nor to someone of another domain", async () => {
        prismaMock.user.findUnique.mockResolvedValue(user("manu@acme.ch", ["acme"], "ADMIN") as never);
        expect((await listSsoConnections("manu")).connectableProviders.map((provider) => provider.providerId)).toEqual(["authentik"]);

        prismaMock.user.findUnique.mockResolvedValue(user("tom@skyfay.ch", ["acme"]) as never);
        expect((await listSsoConnections("tom")).connectableProviders.map((provider) => provider.providerId)).toEqual(["authentik"]);
    });

    it("refuses to start connecting a provider of a tenant someone does not work in", async () => {
        prismaMock.ssoProvider.findUnique.mockResolvedValue(GLOBEX as never);
        prismaMock.user.findUnique.mockResolvedValue(user("lena@globex.ch", ["acme"]) as never);

        expect(await prepareSsoConnect("lena", "okta-globex")).toEqual({ success: false, error: "This provider is not available." });
    });
});
