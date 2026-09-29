// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ getEndpoints: vi.fn() }));

vi.mock("@/services/sso/oidc-registry", () => ({
    getOIDCAdapter: (id: string) => id === "keycloak"
        ? {
              id: "keycloak",
              name: "Keycloak",
              description: "",
              inputs: [
                  { name: "baseUrl", label: "Keycloak URL", type: "url" },
                  { name: "realm", label: "Realm Name", type: "text" },
              ],
              inputSchema: z.object({ baseUrl: z.string().url(), realm: z.string().min(1) }),
              getEndpoints: (...args: unknown[]) => mocks.getEndpoints(...args),
          }
        : undefined,
}));

const { discoverEndpoints } = await import("@/services/sso/oidc-discovery");

const FOUND = {
    issuer: "https://kc.example.ch/realms/staff",
    authorizationEndpoint: "https://kc.example.ch/auth",
    tokenEndpoint: "https://kc.example.ch/token",
    userInfoEndpoint: "https://kc.example.ch/userinfo",
    discoveryEndpoint: "https://kc.example.ch/realms/staff/.well-known/openid-configuration",
};

describe("reading the endpoints of a provider", () => {
    it("hands back the endpoints and only the fields the type knows", async () => {
        mocks.getEndpoints.mockResolvedValue(FOUND);

        const result = await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff", extra: "dropped" });

        expect(result).toEqual({ ok: true, endpoints: FOUND, config: { baseUrl: "https://kc.example.ch", realm: "staff" } });
    });

    it("names the field that is wrong, and an unknown type", async () => {
        expect(await discoverEndpoints("keycloak", { baseUrl: "not a url", realm: "staff" })).toEqual({ ok: false, error: "Check the Keycloak URL." });
        expect(await discoverEndpoints("nope", {})).toEqual({ ok: false, error: "This provider type does not exist." });
    });

    it("says why a provider could not be reached", async () => {
        mocks.getEndpoints.mockRejectedValue(new Error("Status: 404"));

        expect(await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "gone" })).toEqual({ ok: false, error: "The provider could not be reached. Status: 404" });
    });

    it("refuses a provider without the endpoints a sign-in needs", async () => {
        mocks.getEndpoints.mockResolvedValue({ ...FOUND, userInfoEndpoint: undefined });

        expect(await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff" })).toEqual({ ok: false, error: "The provider answered without the endpoints a sign-in needs." });
    });

    it("refuses a provider reached over HTTPS that names its endpoints over HTTP", async () => {
        mocks.getEndpoints.mockResolvedValue({ ...FOUND, tokenEndpoint: "http://kc.example.ch/token" });

        const result = await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff" });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("names its Token endpoint over plain HTTP: http://kc.example.ch/token.");
        expect(!result.ok && result.error).toContain("X-Forwarded-Proto");
    });
});
