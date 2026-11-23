// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ getEndpoints: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: mocks.logError, debug: vi.fn() }) },
}));

// Keycloak with its request mocked, and the real Generic OIDC, whose endpoints are its fields.
const { GenericAdapter } = await vi.hoisted(() => import("@/lib/adapters/oidc/generic"));

vi.mock("@/services/sso/oidc-registry", () => ({
    getOIDCAdapter: (id: string) => id === "generic" ? GenericAdapter : id === "keycloak"
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

const { discoverEndpoints, PROVIDER_UNREACHABLE } = await import("@/services/sso/oidc-discovery");
const { ValidationError } = await import("@/lib/logging/errors");

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

        expect(result).toEqual({ ok: true, endpoints: FOUND, config: { baseUrl: "https://kc.example.ch", realm: "staff" }, dialed: true });
    });

    it("names the field that is wrong, and an unknown type", async () => {
        expect(await discoverEndpoints("keycloak", { baseUrl: "not a url", realm: "staff" })).toEqual({ ok: false, error: "Check the Keycloak URL.", dialed: false });
        expect(await discoverEndpoints("nope", {})).toEqual({ ok: false, error: "This provider type does not exist.", dialed: false });
        expect(mocks.getEndpoints).not.toHaveBeenCalled();
    });

    it("answers a provider that could not be reached with a fixed sentence, never the words of the fetch", async () => {
        mocks.getEndpoints.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:8080 at http://10.0.0.5:8080/realms/gone"));

        const result = await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "gone" });

        expect(result).toEqual({ ok: false, error: PROVIDER_UNREACHABLE, dialed: true });
    });

    it("passes a refusal DBackup wrote for the user", async () => {
        mocks.getEndpoints.mockRejectedValue(new ValidationError("The address of the provider is in a network this tenant may not reach."));

        expect(await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff" }))
            .toEqual({ ok: false, error: "The address of the provider is in a network this tenant may not reach.", dialed: true });
    });

    it("refuses a provider without the endpoints a sign-in needs", async () => {
        mocks.getEndpoints.mockResolvedValue({ ...FOUND, userInfoEndpoint: undefined });

        expect(await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff" })).toEqual({ ok: false, error: "The provider answered without the endpoints a sign-in needs.", dialed: true });
    });

    it("refuses a provider reached over HTTPS that names its endpoints over HTTP", async () => {
        mocks.getEndpoints.mockResolvedValue({ ...FOUND, tokenEndpoint: "http://kc.example.ch/token" });

        const result = await discoverEndpoints("keycloak", { baseUrl: "https://kc.example.ch", realm: "staff" });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("names its Token endpoint over plain HTTP: http://kc.example.ch/token.");
        expect(!result.ok && result.error).toContain("X-Forwarded-Proto");
        expect(result.dialed).toBe(true);
    });

    it("says it dialed nothing for a provider whose endpoints are typed into its fields", async () => {
        const result = await discoverEndpoints("generic", {
            issuer: "https://auth.example.ch",
            authorizationEndpoint: "https://auth.example.ch/authorize",
            tokenEndpoint: "https://auth.example.ch/token",
            userInfoEndpoint: "https://auth.example.ch/userinfo",
        });

        expect(result).toMatchObject({ ok: true, dialed: false });
    });
});
