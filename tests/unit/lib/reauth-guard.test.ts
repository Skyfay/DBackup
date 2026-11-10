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

const { refuseWithoutReauth, passkeyFactorOffRefusal, FRESH_SIGN_IN_MS, SIGN_IN_AGAIN } = await import("@/lib/auth/reauth-guard");
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

    it("deletes the last passkey of the second factor only with the right password", async () => {
        expect(await refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW))).toEqual({ code: "INVALID_PASSWORD", message: "Enter your password." });
        expect(await refusal(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1", password: "guess" } }, signedIn, NOW))).toMatchObject({ code: "INVALID_PASSWORD" });
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1", password: "right" } }, signedIn, NOW)).resolves.toBeUndefined();
    });

    it("deletes any other passkey without the password", async () => {
        prismaMock.passkey.count.mockResolvedValue(2);
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW)).resolves.toBeUndefined();
        prismaMock.passkey.count.mockResolvedValue(1);
        prismaMock.user.findUnique.mockResolvedValue({ passkeyTwoFactor: false } as never);
        await expect(refuseWithoutReauth({ path: "/passkey/delete-passkey", body: { id: "k1" } }, signedIn, NOW)).resolves.toBeUndefined();
    });

    it("turns the passkey factor off only with the password, while a passkey and a password are left", async () => {
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBe("Enter your password.");
        expect(await passkeyFactorOffRefusal("u1", "guess")).toBe("Invalid password");
        expect(await passkeyFactorOffRefusal("u1", "right")).toBeNull();
        prismaMock.passkey.count.mockResolvedValue(0);
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBeNull();
        prismaMock.passkey.count.mockResolvedValue(1);
        prismaMock.account.findFirst.mockResolvedValue(null);
        expect(await passkeyFactorOffRefusal("u1", undefined)).toBeNull();
    });
});
