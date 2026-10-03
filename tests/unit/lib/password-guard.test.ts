import { beforeEach, describe, expect, it, vi } from "vitest";
import { policyOf } from "@/lib/auth/password-policy";

const mocks = vi.hoisted(() => ({ policy: vi.fn() }));

vi.mock("@/services/auth/password-policy-service", () => ({ getPasswordPolicy: () => mocks.policy() }));

const { refuseWeakPassword } = await import("@/lib/auth/password-guard");

const LENA = { user: { name: "Lena Graf", email: "lena@example.ch" } };

describe("the rules of Settings > Passwords at the endpoints of better-auth", () => {
    beforeEach(() => {
        mocks.policy.mockResolvedValue(policyOf("standard"));
    });

    it("refuses a sign-up from the browser whose password breaks a rule, named by the rule", async () => {
        const signUp = refuseWeakPassword({ path: "/sign-up/email", body: { name: "Manu", email: "manu@example.ch", password: "harbor-lamp" } }, async () => null);

        await expect(signUp).rejects.toMatchObject({ body: { code: "PASSWORD_POLICY", message: "The password needs 12 characters or more." } });
    });

    it("keeps the name of a sign-up out of its password", async () => {
        const signUp = refuseWeakPassword({ path: "/sign-up/email", body: { name: "Manu", email: "manu@example.ch", password: "Manu-Backups-2026" } }, async () => null);

        await expect(signUp).rejects.toMatchObject({ body: { message: "The password may not contain the name or the email." } });
    });

    it("checks a changed password against the one who is signed in", async () => {
        const signedIn = vi.fn(async () => LENA);

        await expect(refuseWeakPassword({ path: "/change-password", body: { currentPassword: "old", newPassword: "Grafenried-2026" } }, signedIn)).rejects.toMatchObject({
            body: { message: "The password may not contain the name or the email." },
        });
        await expect(refuseWeakPassword({ path: "/change-password", body: { currentPassword: "old", newPassword: "Harbor-Lamp-42" } }, signedIn)).resolves.toBeUndefined();
        expect(signedIn).toHaveBeenCalledTimes(2);
    });

    it("lets a password through that holds every rule, and leaves other endpoints alone", async () => {
        await expect(refuseWeakPassword({ path: "/sign-up/email", body: { name: "Manu", email: "manu@example.ch", password: "Harbor-Lamp-42" } }, async () => null)).resolves.toBeUndefined();
        await expect(refuseWeakPassword({ path: "/sign-in/email", body: { email: "manu@example.ch", password: "x" } }, async () => null)).resolves.toBeUndefined();
        expect(mocks.policy).toHaveBeenCalledTimes(1);
    });
});
