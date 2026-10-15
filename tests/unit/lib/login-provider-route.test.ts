// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock("@/services/auth/login-page-service", () => ({ findDomainProvider: (...args: unknown[]) => mocks.find(...args) }));

const { POST } = await import("@/app/api/login/provider/route");

const ask = (body: unknown) =>
    POST(new NextRequest("http://localhost/api/login/provider", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("the lookup of the login page for the provider of a domain", () => {
    beforeEach(() => vi.clearAllMocks());

    it("answers for one domain with the provider the page needs, and nothing of its tenant", async () => {
        const provider = { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", domain: "acme.ch", allowProvisioning: true };
        mocks.find.mockResolvedValue(provider);

        const response = await ask({ domain: "acme.ch" });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { provider } });
        expect(mocks.find).toHaveBeenCalledWith("acme.ch");
    });

    it("answers no provider for a domain nobody claims", async () => {
        mocks.find.mockResolvedValue(null);

        expect(await (await ask({ domain: "globex.ch" })).json()).toEqual({ success: true, data: { provider: null } });
    });

    it("refuses a request without a domain, or that is no JSON", async () => {
        expect((await ask({})).status).toBe(400);
        expect((await ask({ domain: "" })).status).toBe(400);
        expect((await ask("not json")).status).toBe(400);
        expect(mocks.find).not.toHaveBeenCalled();
    });
});
