// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

/**
 * A session alone is not the owner: the password that better-auth checks for the second factor goes
 * through the lockout of the account, and what outlives the session, a passkey or the end of the
 * passkey as second factor, asks for a recent sign-in or the password.
 */

const verifyPassword = vi.hoisted(() => vi.fn(async (_userId: string, password: string) => password === "right"));
vi.mock("@/services/auth/auth-service", () => ({ authService: { verifyPassword } }));

const { refuseWithoutReauth, passkeyFactorOffRefusal, keptSessionAge, FRESH_SIGN_IN_MS, SIGN_IN_AGAIN } = await import("@/lib/auth/reauth-guard");
const { MAX_SESSION_CODES, SESSION_CODE_WINDOW_MS, SESSION_CODES_LOCKED, resetSessionCodeTries } = await import("@/services/auth/code-tries");
const { MAX_WRONG_PASSWORDS, PASSWORD_LOCKED, resetPasswordTries } = await import("@/services/auth/password-tries");
const { refusedFromBrowser, profilePermissionFor } = await import("@/lib/auth/profile-guard");

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const sessionSince = (ms: number) => async () => ({ user: { id: "u1" }, session: { createdAt: new Date(NOW - ms) } });
const signedIn = sessionSince(60_000);

/** The error a guard threw, with the code and message better-auth answers. */
async function refusal(run: Promise<unknown>) {
    const error = await run.then(() => null, (thrown: unknown) => thrown as { body?: { code?: string; message?: string } });
    return error ? { code: error.body?.code, message: error.body?.message } : null;
}

describe("the password the second factor asks for", () => {
    beforeEach(() => {
        resetPasswordTries();
        verifyPassword.mockClear();
    });

    it.each(["/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes"])("locks %s after a few wrong passwords, also for the right one", async (path) => {
        for (let attempt = 1; attempt < MAX_WRONG_PASSWORDS; attempt++) {
            expect(await refusal(refuseWithoutReauth({ path, body: { password: "guess" } }, signedIn, NOW))).toEqual({ code: "INVALID_PASSWORD", message: "Invalid password" });
        }
        expect(await refusal(refuseWithoutReauth({ path, body: { password: "guess" } }, signedIn, NOW))).toEqual({ code: "PASSWORD_LOCKED", message: PASSWORD_LOCKED });
        // A right guess during the lockout tells nothing either.
        expect(await refusal(refuseWithoutReauth({ path, body: { password: "right" } }, signedIn, NOW))).toEqual({ code: "PASSWORD_LOCKED", message: PASSWORD_LOCKED });
    });

    it("lets the right password through, which better-auth then checks itself", async () => {
        await expect(refuseWithoutReauth({ path: "/two-factor/enable", body: { password: "right" } }, signedIn, NOW)).resolves.toBeUndefined();
        expect(verifyPassword).toHaveBeenCalledWith("u1", "right");
    });

    it("leaves a request without a password or a session to better-auth", async () => {
        await expect(refuseWithoutReauth({ path: "/two-factor/disable", body: {} }, signedIn, NOW)).resolves.toBeUndefined();
        await expect(refuseWithoutReauth({ path: "/two-factor/disable", body: { password: "guess" } }, async () => null, NOW)).resolves.toBeUndefined();
        expect(verifyPassword).not.toHaveBeenCalled();
    });

    it("refuses /verify-password from the browser, and puts the secret of the app under the right to manage the second factor", () => {
        expect(refusedFromBrowser("/verify-password", true)).toBe(true);
        expect(refusedFromBrowser("/verify-password", false)).toBe(false);
        expect(profilePermissionFor("/two-factor/get-totp-uri", true)).toBe("profile:manage_2fa");
    });
});

describe("adding a passkey", () => {
    it.each(["/passkey/generate-register-options", "/passkey/verify-registration"])("needs a recent sign-in for %s", async (path) => {
        await expect(refuseWithoutReauth({ path }, sessionSince(FRESH_SIGN_IN_MS - 1000), NOW)).resolves.toBeUndefined();
        // A session of any age is no proof of the owner, it may have been taken.
        expect(await refusal(refuseWithoutReauth({ path }, sessionSince(60 * 24 * 3600 * 1000), NOW))).toEqual({ code: "SESSION_NOT_FRESH", message: SIGN_IN_AGAIN });
    });
});

describe("the end of the passkey as second factor", () => {
    beforeEach(() => {
        resetPasswordTries();
        prismaMock.account.findFirst.mockResolvedValue({ id: "cred-u1" } as never);
        prismaMock.passkey.count.mockResolvedValue(1);
        prismaMock.user.findUnique.mockResolvedValue({ passkeyTwoFactor: true } as never);
    });

    it("deletes a passkey of the second factor only with the right password", async () => {
        expect(await refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW))).toEqual({ code: "INVALID_PASSWORD", message: "Enter your password." });
        expect(await refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1", password: "guess" } }, signedIn, NOW))).toMatchObject({ code: "INVALID_PASSWORD" });
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1", password: "right" } }, signedIn, NOW)).resolves.toBeUndefined();
    });

    it("asks for the password however many passkeys are left, so two deletes at once never take the last two without it", async () => {
        // Both requests of the race read two passkeys. Neither passes on that count.
        prismaMock.passkey.count.mockResolvedValue(2);
        const both = await Promise.all([
            refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW)),
            refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k2" } }, signedIn, NOW)),
        ]);
        expect(both).toEqual([{ code: "INVALID_PASSWORD", message: "Enter your password." }, { code: "INVALID_PASSWORD", message: "Enter your password." }]);
    });

    it("deletes a passkey without the password while no passkey is the second factor, or the account has no password", async () => {
        prismaMock.user.findUnique.mockResolvedValue({ passkeyTwoFactor: false } as never);
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW)).resolves.toBeUndefined();
        prismaMock.user.findUnique.mockResolvedValue({ passkeyTwoFactor: true } as never);
        prismaMock.account.findFirst.mockResolvedValue(null);
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW)).resolves.toBeUndefined();
    });

    it("turns the passkey factor off only with the password, also with no passkey left", async () => {
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBe("Enter your password.");
        expect(await passkeyFactorOffRefusal("u1", "guess")).toBe("Invalid password");
        expect(await passkeyFactorOffRefusal("u1", "right")).toBeNull();
        // The state two deletes at once would leave: the factor on and no passkey.
        prismaMock.passkey.count.mockResolvedValue(0);
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBe("Enter your password.");
        expect(await passkeyFactorOffRefusal("u1", "right")).toBeNull();
        prismaMock.passkey.count.mockResolvedValue(1);
        prismaMock.account.findFirst.mockResolvedValue(null);
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBeNull();
    });
});

describe("a code of the second factor sent with a session", () => {
    beforeEach(() => resetSessionCodeTries());

    it.each(["/two-factor/verify-totp", "/two-factor/verify-otp", "/two-factor/verify-backup-code"])("stops the guessing on %s after a few codes per account", async (path) => {
        for (let attempt = 1; attempt <= MAX_SESSION_CODES; attempt++) {
            await expect(refuseWithoutReauth({ path, body: { code: "000000" } }, signedIn, NOW)).resolves.toBeUndefined();
        }
        expect(await refusal(refuseWithoutReauth({ path, body: { code: "000000" } }, signedIn, NOW))).toEqual({ code: "CODE_LOCKED", message: SESSION_CODES_LOCKED });
        // Another session of the same account shares the count, another account does not.
        const other = async () => ({ user: { id: "u2" }, session: { createdAt: new Date(NOW) } });
        await expect(refuseWithoutReauth({ path, body: { code: "000000" } }, other, NOW)).resolves.toBeUndefined();
        // The window ran out.
        await expect(refuseWithoutReauth({ path, body: { code: "000000" } }, signedIn, NOW + SESSION_CODE_WINDOW_MS)).resolves.toBeUndefined();
    });

    it("leaves the code of someone signing in, who has no session yet, to the limits of better-auth", async () => {
        for (let attempt = 0; attempt < MAX_SESSION_CODES + 3; attempt++) {
            await expect(refuseWithoutReauth({ path: "/two-factor/verify-totp", body: { code: "000000" } }, async () => null, NOW)).resolves.toBeUndefined();
        }
    });

    it("keeps an old session old when a right code finishes the setup of the authenticator app, so it adds no passkey", async () => {
        const createdAt = new Date(NOW - 60 * 24 * 3600 * 1000);
        const expiresAt = new Date(NOW + 3600 * 1000);
        const kept = keptSessionAge({ path: "/two-factor/verify-totp", context: { session: { session: { createdAt, expiresAt } } } });
        expect(kept).toEqual({ createdAt, expiresAt });
        // The session better-auth hands out is checked with the age it kept.
        const replaced = async () => ({ user: { id: "u1" }, session: { createdAt: kept!.createdAt } });
        expect(await refusal(refuseWithoutReauth({ path: "/passkey/generate-register-options" }, replaced, NOW))).toEqual({ code: "SESSION_NOT_FRESH", message: SIGN_IN_AGAIN });
        expect(keptSessionAge({ path: "/two-factor/verify-otp", context: { session: { session: { createdAt: createdAt.toISOString() } } } })).toEqual({ createdAt });
    });

    it("gives a sign-in a new session, with or without a second step", () => {
        // The second step of a sign-in carries no session.
        expect(keptSessionAge({ path: "/two-factor/verify-totp", context: { session: null } })).toBeNull();
        expect(keptSessionAge({ path: "/sign-in/email", context: { session: { session: { createdAt: new Date(NOW - 1000) } } } })).toBeNull();
        expect(keptSessionAge(null)).toBeNull();
    });
});
