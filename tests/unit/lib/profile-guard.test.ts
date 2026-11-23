import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { asksTrustedDevice, profileChangeRefused, profilePermissionFor, refusedFromBrowser, userHolds } from "@/lib/auth/profile-guard";

describe("the own profile through better-auth", () => {
    it("needs the permission of the profile for what the browser changes itself", () => {
        expect(profilePermissionFor("/two-factor/enable", true)).toBe("profile:manage_2fa");
        expect(profilePermissionFor("/two-factor/generate-backup-codes", true)).toBe("profile:manage_2fa");
        expect(profilePermissionFor("/passkey/generate-register-options", true)).toBe("profile:manage_passkeys");
        expect(profilePermissionFor("/passkey/delete-passkey", true)).toBe("profile:manage_passkeys");
        // The code that finishes turning the second factor on, which sets it on the account.
        expect(profilePermissionFor("/two-factor/verify-totp", true)).toBe("profile:manage_2fa");
        expect(profilePermissionFor("/two-factor/verify-otp", true)).toBe("profile:manage_2fa");
    });

    it("lets signing in pass, and a call from an action on the server that checked first", () => {
        expect(profilePermissionFor("/passkey/verify-authentication", true)).toBeNull();
        expect(profilePermissionFor("/two-factor/verify-backup-code", true)).toBeNull();
        expect(profilePermissionFor("/sign-in/email", true)).toBeNull();
        expect(profilePermissionFor("/set-password", true)).toBeNull();
        expect(profilePermissionFor("/two-factor/enable", false)).toBeNull();
    });
});

describe("turning the second factor on with the code of the app", () => {
    beforeEach(() => prismaMock.user.findUnique.mockReset());

    const signedIn = async () => ({ user: { id: "u1" } });
    const holding = (...permissions: string[]) =>
        prismaMock.user.findUnique.mockResolvedValue({ platformRole: null, memberships: [{ tenantId: "default", group: { permissions: JSON.stringify(permissions), fullAccess: false } }] } as never);

    it("refuses a signed-in user whose group may not manage the second factor", async () => {
        holding("jobs:read");
        expect(await profileChangeRefused("/two-factor/verify-totp", true, signedIn)).toBe(true);
    });

    it("lets a signed-in user through whose group may manage it", async () => {
        holding("profile:manage_2fa");
        expect(await profileChangeRefused("/two-factor/verify-totp", true, signedIn)).toBe(false);
    });

    it("refuses linking a sign-in provider straight from the browser with a session when the group may not manage the providers", async () => {
        holding("jobs:read");
        expect(await profileChangeRefused("/sign-in/sso", true, signedIn)).toBe(true);
        expect(await profileChangeRefused("/sign-in/social", true, signedIn)).toBe(true);

        holding("profile:manage_sso");
        expect(await profileChangeRefused("/sign-in/sso", true, signedIn)).toBe(false);
    });

    it("lets the login page start a sign-in through a provider, which has no session", async () => {
        holding("jobs:read");
        expect(await profileChangeRefused("/sign-in/sso", true, async () => null)).toBe(false);
    });

    it("lets the code of someone signing in through, who has no session yet", async () => {
        holding("jobs:read");
        expect(await profileChangeRefused("/two-factor/verify-totp", true, async () => null)).toBe(false);
        expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
});

describe("deleting the last passkey while a passkey is the second factor", () => {
    beforeEach(() => {
        prismaMock.user.findUnique.mockReset();
        prismaMock.passkey.count.mockReset();
    });

    const signedIn = async () => ({ user: { id: "u1" } });
    /** The groups of the account and whether a passkey is its second factor, which both read from the user. */
    const account = (passkeyTwoFactor: boolean, ...permissions: string[]) =>
        prismaMock.user.findUnique.mockResolvedValue({ passkeyTwoFactor, platformRole: null, memberships: [{ tenantId: "default", group: { permissions: JSON.stringify(permissions), fullAccess: false } }] } as never);

    it("needs the right to manage the second factor too, since it ends the second factor", async () => {
        prismaMock.passkey.count.mockResolvedValue(1);
        account(true, "profile:manage_passkeys");
        expect(await profileChangeRefused("/passkey/delete-passkey", true, signedIn)).toBe(true);

        account(true, "profile:manage_passkeys", "profile:manage_2fa");
        expect(await profileChangeRefused("/passkey/delete-passkey", true, signedIn)).toBe(false);
    });

    it("needs only the right to manage the passkeys while another passkey stays or a passkey is no second factor", async () => {
        prismaMock.passkey.count.mockResolvedValue(2);
        account(true, "profile:manage_passkeys");
        expect(await profileChangeRefused("/passkey/delete-passkey", true, signedIn)).toBe(false);

        prismaMock.passkey.count.mockResolvedValue(1);
        account(false, "profile:manage_passkeys");
        expect(await profileChangeRefused("/passkey/delete-passkey", true, signedIn)).toBe(false);
    });
});

describe("what only the actions of DBackup change", () => {
    it("refuses the browser unlinking an SSO login or the password, which the action checks and logs", () => {
        expect(refusedFromBrowser("/unlink-account", true)).toBe(true);
    });

    it("refuses the browser changing the user straight, which also sets the passkey as second factor", () => {
        expect(refusedFromBrowser("/update-user", true)).toBe(true);
        expect(refusedFromBrowser("/link-social", true)).toBe(true);
        expect(refusedFromBrowser("/delete-user", true)).toBe(true);
    });

    it("refuses the browser changing the own password straight, which the Profile page does through its action that logs it and ends the other sessions", () => {
        expect(refusedFromBrowser("/change-password", true)).toBe(true);
        expect(refusedFromBrowser("/change-password", false)).toBe(false);
    });

    it("lets the actions call them from the server, and the browser everything else", () => {
        expect(refusedFromBrowser("/unlink-account", false)).toBe(false);
        expect(refusedFromBrowser("/update-user", false)).toBe(false);
        expect(refusedFromBrowser("/revoke-session", true)).toBe(false);
        expect(refusedFromBrowser("/passkey/delete-passkey", true)).toBe(false);
        expect(refusedFromBrowser(undefined, true)).toBe(false);
    });
});

describe("what a user holds through the group", () => {
    beforeEach(() => prismaMock.user.findUnique.mockReset());

    /** An account as the guard reads it, with its groups per tenant. */
    const account = (platformRole: string | null, ...memberships: { tenantId?: string; permissions: string; fullAccess?: boolean }[]) => ({
        platformRole,
        memberships: memberships.map((membership) => ({
            tenantId: membership.tenantId ?? "default",
            group: { permissions: membership.permissions, fullAccess: membership.fullAccess ?? false },
        })),
    });

    it("reads the permissions of the group, every one for a platform admin and none without a group", async () => {
        prismaMock.user.findUnique.mockResolvedValueOnce(account(null, { permissions: '["profile:manage_2fa"]' }) as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce(account(null, { permissions: '["jobs:read"]' }) as never);
        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(account("ADMIN") as never);
        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce(account(null, { permissions: "[]", fullAccess: true }) as never);
        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce(account(null) as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(account(null, { permissions: "not json" }) as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
        expect(await userHolds("gone", "profile:manage_2fa")).toBe(false);
    });

    it("counts the group of any tenant, since the own profile belongs to none", async () => {
        prismaMock.user.findUnique.mockResolvedValueOnce(account(null, { tenantId: "default", permissions: '["jobs:read"]' }, { tenantId: "tenant-a", permissions: '["profile:manage_passkeys"]' }) as never);

        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(true);
    });

    it("lets someone of a platform group change their own profile, also without a group in any tenant", async () => {
        const platformGroup = { platformPermissions: '["platform-accounts:read"]', tenantPermissions: "[]", allTenants: false, tenants: [] };
        prismaMock.user.findUnique.mockResolvedValueOnce({ ...account(null), platformGroup } as never);
        expect(await userHolds("support", "profile:manage_2fa")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce({ ...account(null), platformGroup: null } as never);
        expect(await userHolds("nobody", "profile:manage_2fa")).toBe(false);
    });
});

describe("a trusted device at the second factor", () => {
    // A trusted device skips the second factor on later sign-ins, which then write no sign-in entry.
    it("is refused on every code of the second factor, whatever truthy value asks for it", () => {
        for (const path of ["/two-factor/verify-totp", "/two-factor/verify-otp", "/two-factor/verify-backup-code"]) {
            for (const trustDevice of [true, "true", 1, "yes", {}]) {
                expect(asksTrustedDevice(path, { code: "123456", trustDevice }), `${path} ${String(trustDevice)}`).toBe(true);
            }
        }
    });

    it("lets a code without it pass, and the same field on another endpoint", () => {
        expect(asksTrustedDevice("/two-factor/verify-totp", { code: "123456" })).toBe(false);
        expect(asksTrustedDevice("/two-factor/verify-totp", { code: "123456", trustDevice: false })).toBe(false);
        expect(asksTrustedDevice("/two-factor/verify-otp", undefined)).toBe(false);
        expect(asksTrustedDevice("/sign-in/email", { trustDevice: true })).toBe(false);
        expect(asksTrustedDevice(undefined, { trustDevice: true })).toBe(false);
    });
});
