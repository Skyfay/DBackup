import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));

const { listSsoConnections, prepareSsoConnect } = await import("@/services/sso/sso-connections-service");

const AUTHENTIK = { providerId: "authentik", name: "Authentik", adapterId: "authentik", enabled: true, tenantId: null, domain: null };
const ACME = { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", enabled: true, tenantId: "acme", domain: "acme.ch" };

/** Nina of support, a platform group, who also works in Acme with an email of its domain. */
const NINA = { email: "nina@acme.ch", platformRole: null, platformGroupId: "pg-support", memberships: [{ tenantId: "acme" }] };

describe("the providers an account of a platform group can connect on its profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.account.findMany.mockResolvedValue([]);
        prismaMock.ssoProvider.findMany.mockResolvedValue([AUTHENTIK, ACME] as never);
        // Answers with the fields the service asks for, like Prisma.
        prismaMock.user.findUnique.mockImplementation((async ({ select }: { select: Record<string, unknown> }) =>
            Object.fromEntries(Object.entries(NINA).filter(([key]) => key in select))) as never);
    });

    it("leaves out a provider of a tenant, whose sign-in refuses an account of a platform group", async () => {
        const { connectableProviders } = await listSsoConnections("nina");

        expect(connectableProviders.map((provider) => provider.providerId)).toEqual(["authentik"]);
    });

    it("refuses to start connecting it", async () => {
        prismaMock.ssoProvider.findUnique.mockResolvedValue(ACME as never);

        expect(await prepareSsoConnect("nina", "entra-acme")).toEqual({ success: false, error: "This provider is not available." });
    });
});
