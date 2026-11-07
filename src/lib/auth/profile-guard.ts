import prisma from "@/lib/prisma";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { PLATFORM_ADMIN_ROLE, permissionsIn } from "@/lib/auth/owner-permissions";

/**
 * What of the own profile a group may change holds for the endpoints of better-auth too, which the
 * browser calls itself: the passkeys, the second factor, and the email, which DBackup changes
 * through its own action but better-auth would change directly. A call from the
 * server, like `auth.api.setPassword` in an action that checked first, passes.
 */
const PROFILE_ENDPOINTS: Readonly<Record<string, Permission>> = {
    "/change-email": PERMISSIONS.PROFILE.UPDATE_EMAIL,
    "/two-factor/enable": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/two-factor/disable": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/two-factor/generate-backup-codes": PERMISSIONS.PROFILE.MANAGE_2FA,
    // With a session these finish turning the second factor on. The sign-in has no session yet, so
    // `beforeAuth` lets the code of someone signing in through.
    "/two-factor/verify-totp": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/two-factor/verify-otp": PERMISSIONS.PROFILE.MANAGE_2FA,
    "/passkey/generate-register-options": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/verify-registration": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/update-passkey": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    "/passkey/delete-passkey": PERMISSIONS.PROFILE.MANAGE_PASSKEYS,
    // With a session these link the provider to the own account, like Link on the profile, which
    // checks the same right in `initiateSsoConnect`. The login page has no session and passes.
    "/sign-in/sso": PERMISSIONS.PROFILE.MANAGE_SSO,
    "/sign-in/social": PERMISSIONS.PROFILE.MANAGE_SSO,
};

/**
 * The endpoints of better-auth that change the account and that the browser never calls itself,
 * since DBackup changes these through its own actions, which check the group and write the audit
 * log. `/update-user` also sets the passkey as second factor, `/unlink-account` removes an SSO login
 * or the password (`unlinkMySsoAccount`), `/link-social` adds a login, `/change-password` sets the
 * own password (`updateOwnPassword`, which also ends the other sessions) and `/delete-user` deletes
 * the account. From the server, like in those actions, they pass.
 */
const SERVER_ONLY_ENDPOINTS: ReadonlySet<string> = new Set([
    "/update-user",
    "/change-password",
    "/unlink-account",
    "/link-social",
    "/delete-user",
    "/delete-user/callback",
]);

/** Whether the browser called an endpoint that only an action of DBackup may call. */
export function refusedFromBrowser(path: string | undefined, fromBrowser: boolean): boolean {
    return fromBrowser && !!path && SERVER_ONLY_ENDPOINTS.has(path);
}

export const SERVER_ONLY_ENDPOINT_REFUSED = "DBackup changes this on the Profile page only.";

/**
 * Whether a code of the second factor asks better-auth to trust the device. A trusted device skips
 * the second factor on later sign-ins, which then also write no sign-in to the audit log, and
 * DBackup never offers it, so any truthy `trustDevice` on `/two-factor/verify-*` is refused, from
 * the browser and the server alike.
 */
export function asksTrustedDevice(path: string | undefined, body: unknown): boolean {
    if (!path?.startsWith("/two-factor/verify-")) return false;
    return !!body && typeof body === "object" && !!(body as Record<string, unknown>).trustDevice;
}

export const TRUSTED_DEVICE_REFUSED = "DBackup asks for the second factor at every sign-in and trusts no device.";

/** The permission a call from the browser needs, or null for one that changes nothing of the profile. */
export function profilePermissionFor(path: string | undefined, fromBrowser: boolean): Permission | null {
    if (!fromBrowser || !path) return null;
    return PROFILE_ENDPOINTS[path] ?? null;
}

/**
 * Whether the group refuses a call from the browser to an endpoint of the own profile. A call
 * without a session changes no profile, like the code of the second factor while signing in, and
 * passes. The session is read only for an endpoint of the profile.
 */
export async function profileChangeRefused(
    path: string | undefined,
    fromBrowser: boolean,
    sessionOf: () => Promise<{ user: { id: string } } | null>
): Promise<boolean> {
    const needed = profilePermissionFor(path, fromBrowser);
    if (!needed) return false;
    const session = await sessionOf();
    if (!session) return false;
    if (!(await userHolds(session.user.id, needed))) return true;
    // Deleting the last passkey while a passkey is the second factor ends the second factor, like
    // switching it off, see `togglePasskeyTwoFactor`.
    return path === "/passkey/delete-passkey" && (await lastPasskeyIsFactor(session.user.id)) && !(await userHolds(session.user.id, PERMISSIONS.PROFILE.MANAGE_2FA));
}

/** Whether a passkey is the second factor of the account and it has one passkey left. */
async function lastPasskeyIsFactor(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passkeyTwoFactor: true } });
    return !!user?.passkeyTwoFactor && (await prisma.passkey.count({ where: { userId } })) <= 1;
}

/**
 * Whether a user may change this part of their own profile, which any of their groups gives, and
 * a platform group also without a group in any tenant, a platform admin every part. The profile
 * belongs to no tenant, see `permissionsIn`.
 */
export async function userHolds(userId: string, permission: Permission): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            platformRole: true,
            memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
            platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
        },
    });
    if (!user) return false;
    if (user.platformRole === PLATFORM_ADMIN_ROLE) return true;
    return permissionsIn(user.memberships, null, user.platformGroup).includes(permission);
}

export const PROFILE_CHANGE_REFUSED = "Your group may not change this part of your profile.";
