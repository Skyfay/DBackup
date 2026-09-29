import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    user: vi.fn(),
    provider: vi.fn(),
}));

vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.log } }));
vi.mock("@/lib/prisma", () => ({
    default: {
        user: { findUnique: (...args: unknown[]) => mocks.user(...args) },
        ssoProvider: { findUnique: (...args: unknown[]) => mocks.provider(...args) },
    },
}));

const { recordSignIn, recordSignOut, signInMethod } = await import("@/lib/auth/sign-in-audit");

const headers = new Headers({ "x-forwarded-for": "198.51.100.23", "user-agent": "Mozilla/5.0 Firefox/131.0" });
const session = (twoFactorEnabled = false) => ({
    user: { id: "tom", twoFactorEnabled },
    session: { ipAddress: "198.51.100.23", userAgent: "Mozilla/5.0 Firefox/131.0" },
});

describe("sign-ins in the audit log, written by the server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider.mockResolvedValue({ name: "Authentik" });
        mocks.user.mockResolvedValue(null);
    });

    it("knows the endpoints that sign someone in and nothing else", () => {
        expect(signInMethod("/sign-in/email")).toBe("password");
        expect(signInMethod("/passkey/verify-authentication")).toBe("passkey");
        expect(signInMethod("/two-factor/verify-totp")).toBe("two-factor");
        expect(signInMethod("/sso/callback/:providerId")).toBe("sso");
        expect(signInMethod("/sign-up/email")).toBeNull();
        expect(signInMethod("/get-session")).toBeNull();
    });

    it("writes a sign-in through single sign-on with the name of the provider", async () => {
        await recordSignIn({ path: "/sso/callback/:providerId", params: { providerId: "authentik-417" }, headers, context: { newSession: session() } });

        expect(mocks.log).toHaveBeenCalledWith("tom", "LOGIN", "AUTH", { method: "sso", provider: "Authentik", providerId: "authentik-417" }, undefined, {
            ipAddress: "198.51.100.23",
            userAgent: "Mozilla/5.0 Firefox/131.0",
        });
    });

    it("leaves a password sign-in with a second factor to the second step", async () => {
        await recordSignIn({ path: "/sign-in/email", headers, context: { newSession: session(true) } });
        expect(mocks.log).not.toHaveBeenCalled();

        await recordSignIn({ path: "/two-factor/verify-totp", headers, context: { newSession: session(true) } });
        expect(mocks.log).toHaveBeenCalledWith("tom", "LOGIN", "AUTH", { method: "two-factor" }, undefined, expect.any(Object));
    });

    it("writes a turned down password with the account it tried, but nobody as its author", async () => {
        mocks.user.mockResolvedValue({ id: "lena" });

        await recordSignIn({ path: "/sign-in/email", body: { email: " Lena@Example.ch " }, headers, context: { newSession: null, returned: { statusCode: 401, status: "UNAUTHORIZED" } } });

        expect(mocks.user).toHaveBeenCalledWith({ where: { email: "lena@example.ch" }, select: { id: true } });
        expect(mocks.log).toHaveBeenCalledWith(null, "LOGIN_FAILED", "AUTH", { method: "password", email: "lena@example.ch", reason: "wrong_password" }, "lena", {
            ipAddress: "198.51.100.23",
            userAgent: "Mozilla/5.0 Firefox/131.0",
        });
    });

    it("tells an email nobody has apart from a wrong password", async () => {
        await recordSignIn({ path: "/sign-in/email", body: { email: "admin@example.ch" }, headers, context: { returned: { statusCode: 401 } } });

        expect(mocks.log).toHaveBeenCalledWith(null, "LOGIN_FAILED", "AUTH", expect.objectContaining({ reason: "unknown_email" }), undefined, expect.any(Object));
    });

    it("writes nothing for other endpoints or a sign-in that went through without a session", async () => {
        await recordSignIn({ path: "/get-session", headers, context: { newSession: session() } });
        await recordSignIn({ path: "/sign-in/email", headers, context: { returned: { twoFactorRedirect: true } } });

        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("writes a sign-out for the session it ends", async () => {
        await recordSignOut({ path: "/sign-out", headers, context: {} }, { user: { id: "tom" } });
        await recordSignOut({ path: "/sign-out", headers, context: {} }, null);

        expect(mocks.log).toHaveBeenCalledTimes(1);
        expect(mocks.log).toHaveBeenCalledWith("tom", "LOGOUT", "AUTH", {}, undefined, expect.objectContaining({ ipAddress: "198.51.100.23" }));
    });
});
