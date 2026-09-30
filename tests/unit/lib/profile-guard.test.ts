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

    it("reads the permissions of the group, every one for a SuperAdmin and none without a group", async () => {
        prismaMock.user.findUnique.mockResolvedValueOnce({ group: { name: "Operators", permissions: '["profile:manage_2fa"]' } } as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce({ group: { name: "Operators", permissions: '["jobs:read"]' } } as never);
        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce({ group: { name: "SuperAdmin", permissions: "[]" } } as never);
        expect(await userHolds("u1", "profile:manage_passkeys")).toBe(true);

        prismaMock.user.findUnique.mockResolvedValueOnce({ group: null } as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce({ group: { name: "Broken", permissions: "not json" } } as never);
        expect(await userHolds("u1", "profile:manage_2fa")).toBe(false);
    });
});
