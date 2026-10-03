// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { buildSsoProvidersModel, configOf, otherWaysOf, placeOf, PROVIDER_SELECT } = await import("@/services/sso/sso-providers-model");
type Provider = Parameters<typeof buildSsoProvidersModel>[0]["providers"][number];
type Person = Parameters<typeof buildSsoProvidersModel>[0]["people"][number];

const at = (iso: string) => new Date(iso);

const provider = (fields: Partial<Provider>): Provider => ({
    id: "sso-1",
    providerId: "authentik",
    name: "Authentik",
    adapterId: "authentik",
    enabled: true,
    domain: null,
    clientId: "dbackup",
    adapterConfig: JSON.stringify({ baseUrl: "https://auth.example.ch", slug: "dbackup" }),
    issuer: "https://auth.example.ch/application/o/dbackup/",
    authorizationEndpoint: "https://auth.example.ch/application/o/authorize/",
    tokenEndpoint: "https://auth.example.ch/application/o/token/",
    userInfoEndpoint: "https://auth.example.ch/application/o/userinfo/",
    jwksEndpoint: null,
    allowProvisioning: true,
    defaultGroupId: null,
    createdAt: at("2026-09-01T10:00:00Z"),
    updatedAt: at("2026-09-02T10:00:00Z"),
    ...fields,
});

const person = (id: string, name: string, accounts: [string, string][], passkeys = 0): Person => ({
    id,
    name,
    email: `${id}@example.ch`,
    image: null,
    accounts: accounts.map(([providerId, iso]) => ({ providerId, updatedAt: at(iso) })),
    _count: { passkeys },
});

const TOM = person("tom", "Tom Weber", [["authentik", "2026-09-29T08:00:00Z"]]);
const SARA = person("sara", "Sara Nguyen", [["authentik", "2026-09-27T08:00:00Z"]], 1);
const MANU = person("manu", "Manu", [["authentik", "2026-09-17T08:00:00Z"], ["credential", "2026-01-01T00:00:00Z"], ["pocket-id", "2026-09-28T08:00:00Z"]]);

const build = (overrides: Partial<Parameters<typeof buildSsoProvidersModel>[0]> = {}) =>
    buildSsoProvidersModel({
        providers: [provider({}), provider({ id: "sso-2", providerId: "pocket-id", name: "Pocket ID", adapterId: "pocket-id", adapterConfig: JSON.stringify({ baseUrl: "https://id.example.ch" }), enabled: false })],
        people: [TOM, SARA, MANU],
        groups: [{ id: "g-ops", name: "Operators", permissions: JSON.stringify(["jobs:read", "made:up"]), _count: { users: 3 } }],
        signIns: 48,
        passwordSignIn: true,
        passkeys: true,
        autoRedirect: null,
        callbackBase: "https://backup.example.ch/api/auth/sso/callback/",
        canManage: false,
        ...overrides,
    });

describe("the SSO tab", () => {
    it("never reads the client secret or the config better-auth keeps it in", () => {
        expect(PROVIDER_SELECT).not.toHaveProperty("clientSecret");
        expect(PROVIDER_SELECT).not.toHaveProperty("oidcConfig");
    });

    it("lists who is linked through each provider, the newest sign-in first, and what else lets them in", () => {
        const [authentik, pocket] = build().providers;

        expect(authentik.linked.map((entry) => [entry.name, entry.otherWays])).toEqual([
            ["Tom Weber", []],
            ["Sara Nguyen", ["a passkey"]],
            // Pocket ID is off, so it is no way in right now.
            ["Manu", ["a password"]],
        ]);
        expect(authentik.lastSignIn).toEqual({ at: "2026-09-29T08:00:00.000Z", name: "Tom Weber" });
        expect(pocket.linked.map((entry) => entry.otherWays)).toEqual([["a password", "Authentik"]]);
    });

    it("counts what stops working without a password or passkeys", () => {
        const model = build({ passwordSignIn: false, passkeys: false });

        expect(model.providers[0].linked.map((entry) => entry.otherWays)).toEqual([[], [], []]);
        expect(model.stats.onlyThrough).toEqual(["Manu", "Sara Nguyen", "Tom Weber"]);
        expect(build().stats.onlyThrough).toEqual(["Tom Weber"]);
    });

    it("sums up the providers for the numbers above the list", () => {
        const { stats } = build();

        expect(stats).toEqual({
            providers: 2,
            enabled: 1,
            disabled: ["Pocket ID"],
            linked: 3,
            linkedBy: [
                { name: "Authentik", count: 3 },
                { name: "Pocket ID", count: 1 },
            ],
            onlyThrough: ["Tom Weber"],
            signIns: 48,
        });
    });

    it("names the group new people start in, and none for a group that is gone", () => {
        const model = build({ providers: [provider({ defaultGroupId: "g-ops" }), provider({ id: "sso-3", providerId: "kc", name: "Keycloak", defaultGroupId: "g-gone" })] });

        expect(model.providers.map((entry) => entry.group)).toEqual([{ id: "g-ops", name: "Operators" }, null]);
    });

    it("hands out the groups only to someone who may change the providers", () => {
        expect(build().manage).toBeNull();
        expect(build({ canManage: true }).manage).toEqual({
            groups: [{ id: "g-ops", name: "Operators", superAdmin: false, permissions: ["jobs:read"], members: 3 }],
        });
    });

    it("tells where people sign in from the fields of the type", () => {
        expect(placeOf("authentik", { baseUrl: "https://auth.example.ch", slug: "dbackup" }, null)).toEqual({ host: "auth.example.ch", detail: "application dbackup" });
        expect(placeOf("keycloak", { baseUrl: "https://kc.example.ch:8443", realm: "test" }, null)).toEqual({ host: "kc.example.ch:8443", detail: "realm test" });
        expect(placeOf("generic", { issuer: "https://login.example.ch/" }, null)).toEqual({ host: "login.example.ch", detail: null });
        expect(placeOf("pocket-id", {}, "https://id.example.ch")).toEqual({ host: "id.example.ch", detail: null });
    });

    it("reads the fields of a provider saved before they were kept back from its issuer", () => {
        const legacy = { adapterConfig: null, authorizationEndpoint: null, tokenEndpoint: null, userInfoEndpoint: null, jwksEndpoint: null };
        expect(configOf({ ...legacy, adapterId: "keycloak", issuer: "https://kc.example.ch/realms/staff/" })).toEqual({ baseUrl: "https://kc.example.ch", realm: "staff" });
        expect(configOf({ ...legacy, adapterId: "authentik", issuer: "https://auth.example.ch/application/o/dbackup/" })).toEqual({ baseUrl: "https://auth.example.ch", slug: "dbackup" });
        expect(configOf({ ...legacy, adapterId: "pocket-id", issuer: "https://id.example.ch" })).toEqual({ baseUrl: "https://id.example.ch" });
    });

    it("counts another provider only while it is on", () => {
        const ways = { passwordSignIn: true, passkeys: true, enabled: new Map([["authentik", "Authentik"]]) };
        expect(otherWaysOf(MANU, "pocket-id", ways)).toEqual(["a password", "Authentik"]);
        expect(otherWaysOf(MANU, "authentik", ways)).toEqual(["a password"]);
    });
});
