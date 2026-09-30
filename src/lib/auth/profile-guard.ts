import prisma from "@/lib/prisma";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * What of the own profile a group may change holds for the endpoints of better-auth too, which the
 * browser calls itself: the passkeys, the second factor, and the name, the email and the password,
 * which DBackup changes through its own actions but better-auth would change directly. A call from
 * the server, like `auth.api.setPassword` in an action that checked first, passes.
 */
const PROFILE_ENDPOINTS: Readonly<Record<string, Permission>> = {
    "/update-user": PERMISSIONS.PROFILE.UPDATE_NAME,
    "/change-email": PERMISSIONS.PROFILE.UPDATE_EMAIL,
    "/change-password": PERMISSIONS.PROFILE.UPDATE_PASSWORD,
    "/two-factor/enable": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/two-factor/disable": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/two-factor/generate-backup-codes": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/passkey/generate-register-options": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/verify-registration": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/update-passkey": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/delete-passkey": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
};

/** The permission a call from the browser needs, or null for one that changes nothing of the profile. */
export function profilePermissionFor(path: string | undefined, fromBrowser: boolean): Permission | null {
    if (!fromBrowser || !path) return null;
    return PROFILE_ENDPOINTS[path] ?? null;
}

/** Whether a user holds a permission through their group, a SuperAdmin every one. */
export async function userHolds(userId: string, permission: Permission): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { group: { select: { name: true, permissions: true } } } });
    if (!user?.group) return false;
    if (user.group.name === "SuperAdmin") return true;
    try {
        const held: unknown = JSON.parse(user.group.permissions);
        return Array.isArray(held) && held.includes(permission);
    } catch {
        return false;
    }
}

export const PROFILE_CHANGE_REFUSED = "Your group may not change this part of your profile.";
