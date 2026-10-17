import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { profilePermissionFor, userHolds } from "@/lib/auth/profile-guard";

describe("the own profile through better-auth", () => {
    it("needs the permission of the profile for what the browser changes itself", () => {
        expect(profilePermissionFor("/two-factor/enable", true)).toBe("profile:manage_2fa");
        expect(profilePermissionFor("/two-factor/generate-backup-codes", true)).toBe("profile:manage_2fa");
        expect(profilePermissionFor("/passkey/generate-register-options", true)).toBe("profile:manage_passkeys");
        expect(profilePermissionFor("/passkey/delete-passkey", true)).toBe("profile:manage_passkeys");
        expect(profilePermissionFor("/update-user", true)).toBe("profile:update_name");
        expect(profilePermissionFor("/change-password", true)).toBe("profile:update_password");
    });

    it("lets signing in pass, and a call from an action on the server that checked first", () => {
        expect(profilePermissionFor("/passkey/verify-authentication", true)).toBeNull();
        expect(profilePermissionFor("/two-factor/verify-totp", true)).toBeNull();
        expect(profilePermissionFor("/sign-in/email", true)).toBeNull();
        expect(profilePermissionFor("/set-password", true)).toBeNull();
        expect(profilePermissionFor("/two-factor/enable", false)).toBeNull();
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
