import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { buildUsersModel } = await import("@/services/user/users-model");
type Build = Parameters<typeof buildUsersModel>[0];

const NOW = Date.parse("2026-09-29T12:00:00Z");
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const day = (days: number) => new Date(NOW - days * 86_400_000);

function user(overrides: Partial<Build["users"][number]> & { id: string; name: string }): Build["users"][number] {
    return {
        email: `${overrides.id}@example.ch`,
        image: null,
        createdAt: day(100),
        twoFactorEnabled: false,
        passkeyTwoFactor: false,
        group: null,
        accounts: [{ providerId: "credential" }],
        sessions: [],
        _count: { apiKeys: 0, passkeys: 0 },
        ...overrides,
    };
}

const GROUPS: Build["groups"] = [
    { id: "g-view", name: "Viewers", permissions: JSON.stringify(["jobs:read"]), _count: { users: 1 } },
    { id: "g-super", name: "SuperAdmin", permissions: "[]", _count: { users: 1 } },
    { id: "g-ops", name: "Operators", permissions: "not json", _count: { users: 1 } },
];

function build(users: Build["users"], logins: Build["logins"] = new Map()) {
    return buildUsersModel({
        users,
        groups: GROUPS,
        providers: [{ providerId: "authentik-417", name: "Authentik", adapterId: "authentik" }],
        logins,
        viewerId: "manu",
        viewerSuperAdmin: true,
        now: NOW,
    });
}

describe("the users of the Users tab", () => {
    it("names how each user signs in and what protects it", () => {
        const model = build([
            user({ id: "manu", name: "Manu", passkeyTwoFactor: true, twoFactorEnabled: true, accounts: [{ providerId: "credential" }, { providerId: "authentik-417" }], _count: { apiKeys: 2, passkeys: 1 } }),
            user({ id: "lena", name: "Lena Graf", twoFactorEnabled: true }),
            user({ id: "tom", name: "Tom Weber", accounts: [{ providerId: "authentik-417" }] }),
            user({ id: "jana", name: "Jana Keller" }),
            user({ id: "pia", name: "Pia", accounts: [], _count: { apiKeys: 0, passkeys: 2 } }),
        ]);
        const byId = new Map(model.users.map((row) => [row.id, row]));

        expect(byId.get("manu")?.methods).toEqual([
            { kind: "password" },
            { kind: "passkey", count: 1 },
            { kind: "sso", providerId: "authentik-417", name: "Authentik", adapterId: "authentik" },
        ]);
        expect(byId.get("manu")?.secondFactor).toBe("passkey");
        expect(byId.get("manu")?.isYou).toBe(true);
        expect(byId.get("lena")?.secondFactor).toBe("app");
        expect(byId.get("tom")?.secondFactor).toBe("sso");
        expect(byId.get("jana")?.secondFactor).toBe("none");
        expect(byId.get("pia")?.secondFactor).toBe("no-password");
        expect(model.stats.passwordOnly).toEqual(["Jana Keller"]);
        expect(model.stats.protected).toBe(4);
    });

    it("leaves out the session a new user got on the server, which no browser holds", () => {
        const model = build([
            user({ id: "sara", name: "Sara Nguyen", sessions: [{ createdAt: day(2), expiresAt: day(-5), userAgent: null, ipAddress: null }] }),
        ]);

        expect(model.users[0].sessions).toBe(0);
        expect(model.users[0].lastSignIn).toBeNull();
        expect(model.stats.never).toEqual(["Sara Nguyen"]);
        expect(model.stats.sessions).toBe(0);
    });

    it("takes the newer of the last sign-in in the audit log and the newest session", () => {
        const model = build(
            [
                user({ id: "lena", name: "Lena Graf", sessions: [{ createdAt: day(1), expiresAt: day(-6), userAgent: FIREFOX, ipAddress: "10.0.4.21" }] }),
                user({ id: "jana", name: "Jana Keller", sessions: [{ createdAt: day(40), expiresAt: day(33), userAgent: FIREFOX, ipAddress: null }] }),
            ],
            new Map([
                ["lena", { createdAt: day(3), userAgent: SAFARI_IPHONE, ipAddress: "unknown" }],
                ["jana", { createdAt: day(12), userAgent: "unknown", ipAddress: "unknown" }],
            ])
        );
        const byId = new Map(model.users.map((row) => [row.id, row]));

        expect(byId.get("lena")?.lastSignIn).toEqual({ at: day(1).toISOString(), agent: { browser: "Firefox", os: "macOS", device: "desktop" }, ip: "10.0.4.21" });
        // The session of Jana ran out long ago, the audit log knows a later sign-in without its browser.
        expect(byId.get("jana")?.lastSignIn).toEqual({ at: day(12).toISOString(), agent: null, ip: null });
        expect(byId.get("jana")?.sessions).toBe(0);
        expect(model.stats.signedIn).toBe(2);
    });

    it("counts the open sessions and the browsers they run in", () => {
        const model = build([
            user({
                id: "manu",
                name: "Manu",
                sessions: [
                    { createdAt: day(1), expiresAt: day(-6), userAgent: FIREFOX, ipAddress: null },
                    { createdAt: day(2), expiresAt: day(-5), userAgent: FIREFOX, ipAddress: null },
                    { createdAt: day(3), expiresAt: day(-4), userAgent: SAFARI_IPHONE, ipAddress: null },
                ],
            }),
            user({ id: "lena", name: "Lena Graf", sessions: [{ createdAt: day(1), expiresAt: day(-6), userAgent: FIREFOX, ipAddress: null }] }),
        ]);

        expect(model.stats.sessions).toBe(4);
        expect(model.stats.devices).toBe(3);
    });

    it("counts who has no group and lists the SuperAdmin group first", () => {
        const model = build([
            user({ id: "manu", name: "Manu", group: { id: "g-super", name: "SuperAdmin" } }),
            user({ id: "sara", name: "Sara Nguyen" }),
        ]);

        expect(model.users.find((row) => row.id === "manu")?.superAdmin).toBe(true);
        expect(model.stats.inGroup).toBe(1);
        expect(model.stats.withoutGroup).toEqual(["Sara Nguyen"]);
        expect(model.groups.map((group) => group.name)).toEqual(["SuperAdmin", "Operators", "Viewers"]);
        expect(model.groups.find((group) => group.name === "Operators")?.permissions).toEqual([]);
    });
});
