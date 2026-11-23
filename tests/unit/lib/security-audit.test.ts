/**
 * Changes of the own second factor and passkeys, which the browser makes through the endpoints of
 * better-auth, in the audit log: the hooks around those endpoints write an entry once the endpoint
 * succeeded, into the log of the tenant the account works in when it is one of its people.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeEntry } from "@/lib/core/audit-sentence";

// The custom server sets the header of the address, which the app trusts only then.
vi.stubEnv("DBACKUP_CUSTOM_SERVER", "1");

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    twoFactor: vi.fn(),
    passkey: vi.fn(),
    user: vi.fn(),
    isPersonOf: vi.fn(),
    sessions: vi.fn(),
}));

vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.log } }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: { isPersonOf: mocks.isPersonOf } }));
vi.mock("@/lib/prisma", () => ({
    default: {
        twoFactor: { findUnique: (...args: unknown[]) => mocks.twoFactor(...args) },
        passkey: { findFirst: (...args: unknown[]) => mocks.passkey(...args) },
        user: { findUnique: (...args: unknown[]) => mocks.user(...args) },
        session: { count: (...args: unknown[]) => mocks.sessions(...args) },
    },
}));

const { noteSecurityChange, recordSecurityChange } = await import("@/lib/auth/security-audit");
const { recordSignIn } = await import("@/lib/auth/sign-in-audit");

const headers = new Headers({ "x-dbackup-client-address": "198.51.100.23", "user-agent": "Mozilla/5.0 Firefox/131.0" });

/** One request through both hooks, as better-auth runs it: the same context before and after the endpoint. */
async function request(path: string, body: unknown, returned: unknown, activeTenantId: string | null = "acme") {
    const context: { session: { user: { id: string; name: string }; session: { activeTenantId: string | null } } | null; returned?: unknown } = {
        session: { user: { id: "tom", name: "Tom" }, session: { activeTenantId } },
    };
    const ctx = { path, body, headers, context };
    await noteSecurityChange(ctx);
    context.returned = returned;
    await recordSecurityChange(ctx);
}

const entry = (details: Record<string, unknown>, tenantId = "acme") => [
    "tom", "UPDATE", "USER", { name: "Tom", ...details }, "tom",
    { tenantId, ipAddress: "198.51.100.23", userAgent: "Mozilla/5.0 Firefox/131.0" },
];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ name: "Tom" });
    mocks.isPersonOf.mockResolvedValue(true);
    mocks.twoFactor.mockResolvedValue({ verified: false });
    mocks.passkey.mockResolvedValue({ name: "Office laptop" });
});

describe("the own second factor in the audit log", () => {
    it("writes the setup of the app, the code that turns it on, turning it off and new backup codes", async () => {
        await request("/two-factor/enable", { password: "secret" }, { totpURI: "otpauth://x", backupCodes: [] });
        await request("/two-factor/verify-totp", { code: "123456" }, { token: "t" });
        await request("/two-factor/disable", { password: "secret" }, { status: true });
        await request("/two-factor/generate-backup-codes", { password: "secret" }, { status: true, backupCodes: [] });

        expect(mocks.log.mock.calls).toEqual([
            entry({ change: "Authenticator app set up" }),
            entry({ change: "Second factor turned on" }),
            entry({ change: "Second factor turned off" }),
            entry({ change: "Backup codes renewed" }),
        ]);
        // Nothing of the secret or the codes goes into the log.
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secret");
    });

    it("writes nothing for a code of an app that is set up already, nor for a sign-in, which sign-in-audit.ts writes", async () => {
        mocks.twoFactor.mockResolvedValue({ verified: true });
        await request("/two-factor/verify-totp", { code: "123456" }, { token: "t" });

        const signIn = { path: "/two-factor/verify-totp", body: { code: "123456" }, headers, context: { session: null, returned: { token: "t" } } };
        await noteSecurityChange(signIn);
        await recordSecurityChange(signIn);

        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("writes the app removed, not the second factor off, while a passkey stays the second factor", async () => {
        mocks.user.mockResolvedValue({ name: "Tom", passkeyTwoFactor: true });
        await request("/two-factor/disable", { password: "secret" }, { status: true });

        expect(mocks.log.mock.calls).toEqual([entry({ change: "Authenticator app removed" })]);
    });

    it("writes nothing for an endpoint that refused", async () => {
        const refused = Object.assign(new Error("Invalid password"), { statusCode: 400 });
        await request("/two-factor/disable", { password: "wrong" }, refused);

        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("goes into the log of the platform when the account is no person of the tenant it works in", async () => {
        mocks.isPersonOf.mockResolvedValue(false);
        await request("/two-factor/disable", {}, { status: true });
        await request("/two-factor/disable", {}, { status: true }, "*");

        expect(mocks.log.mock.calls).toEqual([entry({ change: "Second factor turned off" }, "default"), entry({ change: "Second factor turned off" }, "default")]);
    });
});

describe("the own passkeys in the audit log", () => {
    it("writes a new passkey, a new name with the old one and a deleted passkey by its name", async () => {
        await request("/passkey/verify-registration", { response: {}, name: "Office laptop" }, { id: "pk1", name: "Office laptop" });
        await request("/passkey/update-passkey", { id: "pk1", name: "Home laptop" }, { passkey: { id: "pk1", name: "Home laptop" } });
        await request("/passkey/delete-passkey", { id: "pk1" }, { status: true });

        expect(mocks.log.mock.calls).toEqual([
            entry({ change: "Passkey added", passkey: "Office laptop" }),
            entry({ change: "Passkey renamed", passkey: "Home laptop", changes: [{ field: "Passkey name", from: "Office laptop", to: "Home laptop" }] }),
            entry({ change: "Passkey deleted", passkey: "Office laptop" }),
        ]);
        expect(mocks.passkey).toHaveBeenCalledWith({ where: { id: "pk1", userId: "tom" }, select: { name: true } });
    });

    it("reads as a sentence in the Audit log tab", () => {
        const sentence = (details: Record<string, unknown>) => describeEntry({ action: "UPDATE", resource: "USER", details: JSON.stringify({ name: "Tom", ...details }) }).parts.map((part) => part.text).join("");

        expect(sentence({ change: "Second factor turned on" })).toBe("Turned on the own second factor");
        expect(sentence({ change: "Second factor turned off" })).toBe("Turned off the own second factor");
        expect(sentence({ change: "Authenticator app removed" })).toBe("Removed the authenticator app, a passkey stays the own second factor");
        expect(sentence({ change: "Authenticator app set up" })).toBe("Set up an authenticator app for the own second factor");
        expect(sentence({ change: "Backup codes renewed" })).toBe("Made new backup codes for the own second factor");
        expect(sentence({ change: "Passkey added", passkey: "Office laptop" })).toBe("Added the passkey Office laptop to the own account");
        expect(sentence({ change: "Passkey renamed", passkey: "Home laptop" })).toBe("Renamed a passkey of the own account to Home laptop");
        expect(sentence({ change: "Passkey deleted" })).toBe("Deleted a passkey");
    });
});

describe("the own sessions ended from the browser in the audit log", () => {
    it("writes a session ended, the other sessions ended and every session ended", async () => {
        mocks.sessions.mockResolvedValue(2);
        await request("/revoke-session", { token: "tok-laptop" }, { status: true });
        await request("/revoke-other-sessions", {}, { status: true });
        await request("/revoke-sessions", {}, { status: true });

        expect(mocks.log.mock.calls).toEqual([
            entry({ change: "Own session ended" }),
            entry({ change: "Other own sessions ended", sessions: 2 }),
            entry({ change: "Every own session ended", sessions: 2 }),
        ]);
        // Only a session of the own account counts, the token never goes into the log.
        expect(mocks.sessions).toHaveBeenCalledWith({ where: { token: "tok-laptop", userId: "tom" } });
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("tok-laptop");
    });

    it("writes nothing when the token is of no session of the account, which better-auth answers like a success", async () => {
        mocks.sessions.mockResolvedValue(0);
        await request("/revoke-session", { token: "tok-of-someone-else" }, { status: true });
        await request("/revoke-other-sessions", {}, { status: true });

        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("reads the session of the request itself, which no guard of the profile read before", async () => {
        mocks.sessions.mockResolvedValue(1);
        const context: { session: { user: { id: string; name: string }; session: { activeTenantId: string | null; token: string } } | null; returned?: unknown } = { session: null };
        const ctx = { path: "/revoke-other-sessions", body: {}, headers, context };
        await noteSecurityChange(ctx, async () => {
            context.session = { user: { id: "tom", name: "Tom" }, session: { activeTenantId: "acme", token: "tok-here" } };
        });
        context.returned = { status: true };
        await recordSecurityChange(ctx);

        expect(mocks.sessions).toHaveBeenCalledWith({ where: { userId: "tom", expiresAt: { gt: expect.any(Date) }, token: { not: "tok-here" } } });
        expect(mocks.log.mock.calls).toEqual([entry({ change: "Other own sessions ended", sessions: 1 })]);
    });

    it("reads as a sentence in the Audit log tab", () => {
        const sentence = (change: string) => describeEntry({ action: "UPDATE", resource: "USER", details: JSON.stringify({ name: "Tom", change }) }).parts.map((part) => part.text).join("");

        expect(sentence("Own session ended")).toBe("Ended a session of the own account");
        expect(sentence("Other own sessions ended")).toBe("Signed the own account out on every other device");
        expect(sentence("Every own session ended")).toBe("Signed the own account out everywhere");
    });
});

describe("turning the second factor on", () => {
    it("is no sign-in, though better-auth hands out a new session for it", async () => {
        await recordSignIn({
            path: "/two-factor/verify-totp",
            headers,
            context: {
                session: { session: { id: "old" } },
                newSession: { user: { id: "tom", twoFactorEnabled: true }, session: { ipAddress: null, userAgent: null } },
            },
        });

        expect(mocks.log).not.toHaveBeenCalled();
    });
});
