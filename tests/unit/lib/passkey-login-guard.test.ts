import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));

const { PASSKEY_LOGIN_OFF, PASSKEY_LOGIN_OFF_KEY, isPasskeyLoginOff, refusePasskeyFirstFactor } = await import("@/lib/auth/passkey-login-guard");

const VERIFY = "/passkey/verify-authentication";

/**
 * A request to the endpoint as the middleware of better-auth sees it. `pending` is the account the
 * signed `two_factor` cookie of a password that was just right stands for, left out for none.
 */
function request(options: { pending?: { userId: string; expiresAt?: Date }; credential?: string; path?: string } = {}) {
    const { pending, credential = "cred-lena", path = VERIFY } = options;
    return {
        path,
        body: { response: { id: credential, rawId: credential, type: "public-key" } },
        getSignedCookie: vi.fn(async (name: string) => (pending && name === "better-auth.two_factor" ? "2fa-abc" : null)),
        context: {
            secret: "s",
            createAuthCookie: (name: string) => ({ name: `better-auth.${name}` }),
            internalAdapter: {
                findVerificationValue: vi.fn(async (identifier: string) =>
                    pending && identifier === "2fa-abc" ? { value: pending.userId, expiresAt: pending.expiresAt ?? new Date(Date.now() + 600_000) } : null),
            },
        },
    };
}

describe("the sign-in with a passkey while Settings > Sign-in switched it off", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: PASSKEY_LOGIN_OFF_KEY, value: "true" } as never);
        prismaMock.passkey.findUnique.mockImplementation((async ({ where }: { where: { credentialID: string } }) =>
            ({ "cred-lena": { userId: "lena" }, "cred-eve": { userId: "eve" } })[where.credentialID] ?? null) as never);
    });

    it("refuses a passkey as the first factor on the server, not only by hiding the button", async () => {
        await expect(refusePasskeyFirstFactor(request())).rejects.toMatchObject({ body: { code: "PASSKEY_LOGIN_DISABLED", message: PASSKEY_LOGIN_OFF } });
        expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: "auth.disablePasskeyLogin" }, select: { value: true } });
    });

    it("keeps a passkey working as the second factor of the account whose password was just right", async () => {
        await expect(refusePasskeyFirstFactor(request({ pending: { userId: "lena" } }))).resolves.toBeUndefined();
        expect(prismaMock.passkey.findUnique).toHaveBeenCalledWith({ where: { credentialID: "cred-lena" }, select: { userId: true } });
    });

    it("refuses a passkey of another account behind the cookie of a password, and an unknown one", async () => {
        await expect(refusePasskeyFirstFactor(request({ pending: { userId: "lena" }, credential: "cred-eve" }))).rejects.toMatchObject({ body: { code: "PASSKEY_LOGIN_DISABLED" } });
        await expect(refusePasskeyFirstFactor(request({ pending: { userId: "lena" }, credential: "cred-gone" }))).rejects.toMatchObject({ body: { code: "PASSKEY_LOGIN_DISABLED" } });
    });

    it("refuses once the second factor ran out, which better-auth still hands back once", async () => {
        await expect(refusePasskeyFirstFactor(request({ pending: { userId: "lena", expiresAt: new Date(Date.now() - 1000) } }))).rejects.toMatchObject({ body: { code: "PASSKEY_LOGIN_DISABLED" } });
    });

    it("lets every passkey in while the sign-in with a passkey is on", async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        await expect(refusePasskeyFirstFactor(request())).resolves.toBeUndefined();

        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: PASSKEY_LOGIN_OFF_KEY, value: "false" } as never);
        await expect(refusePasskeyFirstFactor(request())).resolves.toBeUndefined();
        expect(await isPasskeyLoginOff()).toBe(false);
    });

    it("leaves the other endpoints of passkeys alone, like adding one to the own account", async () => {
        await expect(refusePasskeyFirstFactor(request({ path: "/passkey/generate-register-options" }))).resolves.toBeUndefined();
        await expect(refusePasskeyFirstFactor(request({ path: "/sign-in/email" }))).resolves.toBeUndefined();
        expect(prismaMock.systemSetting.findUnique).not.toHaveBeenCalled();
    });
});
