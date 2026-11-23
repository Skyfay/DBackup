import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyPassword: vi.fn() }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { verifyPassword: mocks.verifyPassword } }));

const { checkCurrentPassword, MAX_WRONG_PASSWORDS, PASSWORD_LOCKOUT_MS, resetPasswordTries, WRONG_PASSWORD_WINDOW_MS } = await import("@/services/auth/password-tries");

const T0 = Date.UTC(2026, 10, 7, 10);

/** Sends wrong passwords until one short of the lockout. */
async function almostLocked(userId: string, now = T0) {
    mocks.verifyPassword.mockResolvedValue(false);
    for (let attempt = 1; attempt < MAX_WRONG_PASSWORDS; attempt++) expect(await checkCurrentPassword(userId, "guess", now)).toBe("wrong");
}

describe("the wrong current passwords of an account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetPasswordTries();
    });

    it("locks the account after a few wrong ones, and checks nothing while it is locked", async () => {
        await almostLocked("lena");
        expect(await checkCurrentPassword("lena", "guess", T0)).toBe("locked");

        mocks.verifyPassword.mockResolvedValue(true);
        expect(await checkCurrentPassword("lena", "right", T0 + PASSWORD_LOCKOUT_MS - 1)).toBe("locked");
        expect(mocks.verifyPassword).toHaveBeenCalledTimes(MAX_WRONG_PASSWORDS);

        // Once the lockout ran out, the right password works again.
        expect(await checkCurrentPassword("lena", "right", T0 + PASSWORD_LOCKOUT_MS)).toBe("ok");
    });

    it("counts per account", async () => {
        await almostLocked("lena");
        expect(await checkCurrentPassword("lena", "guess", T0)).toBe("locked");
        expect(await checkCurrentPassword("tom", "guess", T0)).toBe("wrong");
    });

    it("forgets the wrong ones after a right one, and after the window ran out", async () => {
        await almostLocked("lena");
        mocks.verifyPassword.mockResolvedValue(true);
        expect(await checkCurrentPassword("lena", "right", T0)).toBe("ok");
        await almostLocked("lena");

        resetPasswordTries();
        await almostLocked("lena");
        expect(await checkCurrentPassword("lena", "guess", T0 + WRONG_PASSWORD_WINDOW_MS)).toBe("wrong");
    });

    it("checks no more passwords than allowed when many requests come at once", async () => {
        mocks.verifyPassword.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return false;
        });
        const results = await Promise.all(Array.from({ length: 20 }, () => checkCurrentPassword("lena", "guess", T0)));
        expect(mocks.verifyPassword).toHaveBeenCalledTimes(MAX_WRONG_PASSWORDS);
        expect(results.filter((result) => result === "wrong")).toHaveLength(MAX_WRONG_PASSWORDS - 1);
        expect(await checkCurrentPassword("lena", "guess", T0)).toBe("locked");
    });
});
