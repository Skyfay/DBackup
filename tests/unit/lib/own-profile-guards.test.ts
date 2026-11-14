import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    viewer: { id: "u1", name: "Lena Graf", email: "lena@example.ch", group: { name: "Operators" } },
    held: new Set<string>(),
    service: { updateUser: vi.fn(), togglePasskeyTwoFactor: vi.fn(), ownEmailRefusal: vi.fn(async () => null), passkeyOffEndsTwoFactor: vi.fn(async () => true), hasAuthenticatorApp: vi.fn(async () => true) },
    audit: vi.fn(),
    /** The password of the account and its passkeys, which turning the passkey factor off reads. */
    credential: null as { id: string } | null,
    passkeys: 1,
    passwordCheck: vi.fn(async (): Promise<"ok" | "wrong" | "locked"> => "ok"),
}));

vi.mock("@/lib/auth/access-control", () => ({
    getViewer: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async (permission: string) => mocks.held.has(permission)),
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.held.has(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { unlinkAccount: vi.fn(), signInEmail: vi.fn(), setPassword: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    default: {
        account: { count: vi.fn(async () => 2), findFirst: vi.fn(async () => mocks.credential) },
        passkey: { count: vi.fn(async () => mocks.passkeys) },
        ssoProvider: { findUnique: vi.fn() },
    },
}));
vi.mock("@/services/auth/password-tries", () => ({ checkCurrentPassword: mocks.passwordCheck, PASSWORD_LOCKED: "Locked for a while." }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.service }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));

const { togglePasskeyTwoFactor, updateOwnPassword, updateUser } = await import("@/app/actions/auth/user");
const { initiateSsoConnect, unlinkMySsoAccount } = await import("@/app/actions/auth/sso-connections");

describe("what a group lets someone change of the own profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.held = new Set();
        mocks.service.updateUser.mockResolvedValue({});
        mocks.service.togglePasskeyTwoFactor.mockResolvedValue({});
    });

    it("keeps the password to a group that may change it", async () => {
        expect(await updateOwnPassword("old-secret", "new-secret-123")).toEqual({ success: false, error: "Your group may not change your password." });
    });

    it("keeps the passkey as second factor to a group that may change the passkeys", async () => {
        expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: false, error: "Your group may not change your passkeys." });
        expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();

        mocks.held = new Set(["profile:manage_passkeys"]);
        expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: true });
    });

    it("keeps switching the passkey on to a group that may change the second factor while no authenticator app is one", async () => {
        mocks.service.hasAuthenticatorApp.mockResolvedValue(false);
        try {
            mocks.held = new Set(["profile:manage_passkeys"]);
            expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: false, error: "Your group may not turn on your second factor." });
            expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();

            mocks.held = new Set(["profile:manage_passkeys", "profile:manage_2fa"]);
            expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: true });
            expect(mocks.service.togglePasskeyTwoFactor).toHaveBeenCalledWith("u1", true);
        } finally {
            mocks.service.hasAuthenticatorApp.mockResolvedValue(true);
        }
    });

    it("keeps switching the passkey off to a group that may change the second factor while it is the whole second factor", async () => {
        mocks.held = new Set(["profile:manage_passkeys"]);
        expect(await togglePasskeyTwoFactor("u1", false)).toEqual({ success: false, error: "Your group may not turn off your second factor." });
        expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();

        // An authenticator app stays the second factor, so only the passkey changes.
        mocks.service.passkeyOffEndsTwoFactor.mockResolvedValueOnce(false);
        expect(await togglePasskeyTwoFactor("u1", false)).toEqual({ success: true });

        mocks.held = new Set(["profile:manage_passkeys", "profile:manage_2fa"]);
        expect(await togglePasskeyTwoFactor("u1", false)).toEqual({ success: true });
        expect(mocks.service.togglePasskeyTwoFactor).toHaveBeenCalledTimes(2);
    });

    it("asks for the current password before the own passkey stops being the second factor", async () => {
        mocks.held = new Set(["profile:manage_passkeys", "profile:manage_2fa"]);
        mocks.credential = { id: "cred-u1" };
        try {
            expect(await togglePasskeyTwoFactor("u1", false)).toEqual({ success: false, error: "Enter your password." });
            mocks.passwordCheck.mockResolvedValueOnce("wrong");
            expect(await togglePasskeyTwoFactor("u1", false, "guess")).toEqual({ success: false, error: "Invalid password" });
            mocks.passwordCheck.mockResolvedValueOnce("locked");
            expect(await togglePasskeyTwoFactor("u1", false, "guess")).toEqual({ success: false, error: "Locked for a while." });
            expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();

            expect(await togglePasskeyTwoFactor("u1", false, "right")).toEqual({ success: true });
            expect(mocks.passwordCheck).toHaveBeenLastCalledWith("u1", "right");
            // With the last passkey gone the password is still asked for, the deletes may have run at once.
            mocks.passkeys = 0;
            expect(await togglePasskeyTwoFactor("u1", false)).toEqual({ success: false, error: "Enter your password." });
            expect(await togglePasskeyTwoFactor("u1", false, "right")).toEqual({ success: true });
            // Turning it on asks for nothing.
            expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: true });
        } finally {
            mocks.credential = null;
            mocks.passkeys = 1;
        }
    });

    it("changes the own name and email only as far as the group allows, also for someone who may change users", async () => {
        expect(await updateUser("u1", { name: "Someone Else" })).toEqual({ success: false, error: "Your group may not change your name." });
        expect(await updateUser("u1", { email: "boss@example.ch" })).toEqual({ success: false, error: "Your group may not change your email." });

        mocks.held = new Set(["users:write"]);
        expect(await updateUser("u1", { name: "Someone Else" })).toEqual({ success: false, error: "Your group may not change your name." });
        expect(mocks.service.updateUser).not.toHaveBeenCalled();

        mocks.held = new Set(["profile:update_name"]);
        expect(await updateUser("u1", { name: "Someone Else" })).toEqual({ success: true });
        expect(mocks.service.updateUser).toHaveBeenLastCalledWith("u1", { name: "Someone Else" }, undefined);
    });

    it("refuses a name, an email or a format that is no valid one before it saves anything", async () => {
        mocks.held = new Set(["profile:update_name", "profile:update_email", "users:write"]);

        expect(await updateUser("u1", { name: "x".repeat(500) })).toEqual({ success: false, error: "A name has at most 100 characters." });
        expect(await updateUser("u1", { email: "not an email" })).toEqual({ success: false, error: "That is no email address." });
        expect(await updateUser("u1", { timezone: "Mars/Olympus" })).toEqual({ success: false, error: "That time zone is unknown." });
        expect(await updateUser("u1", { dateFormat: "<script>" })).toEqual({ success: false, error: "Pick one of the date formats." });
        expect(mocks.service.updateUser).not.toHaveBeenCalled();
    });

    it("saves only the fields it knows", async () => {
        mocks.held = new Set(["profile:update_name"]);

        expect(await updateUser("u1", { name: "  Lena Meier ", role: "ADMIN" } as never)).toEqual({ success: true });
        expect(mocks.service.updateUser).toHaveBeenCalledWith("u1", { name: "Lena Meier" }, undefined);
    });

    it("keeps the linked sign-in providers to a group that may change them", async () => {
        const refused = { success: false, error: "Your group may not change your sign-in providers." };
        expect(await unlinkMySsoAccount("authentik", "acc-1")).toEqual(refused);
        expect(await initiateSsoConnect("authentik")).toEqual(refused);
    });

    it("refuses ids that are no strings, empty or too long before anything changes", async () => {
        mocks.held = new Set(["profile:manage_sso", "profile:manage_passkeys"]);
        const invalid = { success: false, error: "Invalid request" };
        const { auth } = await import("@/lib/auth");

        expect(await unlinkMySsoAccount({ id: "authentik" } as unknown as string, "acc-1")).toEqual(invalid);
        expect(await unlinkMySsoAccount("authentik", "x".repeat(500))).toEqual(invalid);
        expect(await initiateSsoConnect("")).toEqual(invalid);
        expect(await initiateSsoConnect(["authentik"] as unknown as string)).toEqual(invalid);
        expect(await togglePasskeyTwoFactor("x".repeat(500), true)).toEqual(invalid);
        expect(await togglePasskeyTwoFactor("u1", "yes" as unknown as boolean)).toEqual(invalid);
        expect(auth.api.unlinkAccount).not.toHaveBeenCalled();
        expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();
    });
});
