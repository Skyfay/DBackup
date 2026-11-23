/**
 * The model of the Profile page: every part of the signed-in user read at once, so the navigation
 * shows the state of each and a part opens without loading.
 */

import prisma from "@/lib/prisma";
import { accessSentences, summarizeAccess } from "@/lib/auth/access-summary";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PasswordPolicy } from "@/lib/auth/password-policy";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import type { TaskColors } from "@/lib/core/task-colors";
import { getTaskColors } from "./preference-service";

export interface ProfileUser {
    id: string;
    name: string;
    email: string;
    image: string | null;
    /** Empty for the time zone of the browser. */
    timezone: string;
    dateFormat: string;
    timeFormat: string;
    autoRedirectOnJobStart: boolean;
    twoFactorEnabled: boolean;
    passkeyTwoFactor: boolean;
}

export interface ProfileModel {
    user: ProfileUser;
    /** The group in the tenant the viewer works in, none in All tenants. */
    group: { id: string; name: string } | null;
    /** Opens every tenant, so no group there is no lack of rights. */
    platformAdmin: boolean;
    /** What the group lets the user do, in up to three sentences. */
    access: string[];
    /** Signs in with a password, so the password and the authenticator app apply. */
    hasPassword: boolean;
    /** The rules of Settings > Passwords, which a new password of one's own follows. */
    passwordPolicy: PasswordPolicy;
    /** A sign-in provider exists or the user is linked to one, so the part lists them. */
    showSignInProviders: boolean;
    /** How many browsers are signed in as the user. */
    sessions: number;
    colors: TaskColors;
    can: {
        updateName: boolean;
        updateEmail: boolean;
        updatePassword: boolean;
        manage2FA: boolean;
        managePasskeys: boolean;
        manageSso: boolean;
        /** Opens the own group under Users & Groups. */
        seeGroups: boolean;
    };
}

/** What a platform admin may do in All tenants, after what that view lets them do. */
const ALL_TENANTS_NOTE = "Changes the connections, jobs and backups of a tenant after opening it, with every permission there.";

export async function getProfileModel(userId: string, viewer: { permissions: string[]; isPlatformAdmin: boolean; tenantId: string | null; allTenants: boolean }): Promise<ProfileModel> {
    const { permissions, isPlatformAdmin, allTenants } = viewer;
    const [user, hasPassword, providers, linked, sessions, colors, passwordPolicy] = await Promise.all([
        prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: {
                id: true, name: true, email: true, image: true, timezone: true, dateFormat: true, timeFormat: true,
                autoRedirectOnJobStart: true, twoFactorEnabled: true, passkeyTwoFactor: true,
                // The group in the tenant the viewer works in, none in All tenants, which is no tenant.
                memberships: { where: { tenantId: viewer.tenantId ?? "" }, select: { group: { select: { id: true, name: true } } } },
            },
        }),
        prisma.account.count({ where: { userId, providerId: "credential" } }).then((count) => count > 0),
        prisma.ssoProvider.count(),
        prisma.account.count({ where: { userId, NOT: { providerId: "credential" } } }),
        prisma.session.count({ where: { userId, expiresAt: { gt: new Date() } } }),
        getTaskColors(userId),
        getPasswordPolicy(),
    ]);
    const has = (permission: string) => isPlatformAdmin || permissions.includes(permission);
    const { memberships, ...rest } = user;
    const group = memberships[0]?.group ?? null;
    // All tenants reads every tenant and changes none, so a platform admin there holds what that
    // view allows, not everything. Only a platform admin has every permission in a tenant opened
    // from there, someone of a platform group what their groups give in it.
    const access = allTenants
        ? [...accessSentences(summarizeAccess(permissions, false)), ...(isPlatformAdmin ? [ALL_TENANTS_NOTE] : [])]
        : accessSentences(summarizeAccess(permissions, isPlatformAdmin));

    return {
        user: { ...rest, twoFactorEnabled: !!rest.twoFactorEnabled, passkeyTwoFactor: !!rest.passkeyTwoFactor },
        group,
        platformAdmin: isPlatformAdmin,
        access,
        hasPassword,
        passwordPolicy,
        showSignInProviders: providers > 0 || linked > 0,
        sessions,
        colors,
        can: {
            updateName: has(PERMISSIONS.PROFILE.UPDATE_NAME),
            updateEmail: has(PERMISSIONS.PROFILE.UPDATE_EMAIL),
            updatePassword: has(PERMISSIONS.PROFILE.UPDATE_PASSWORD),
            manage2FA: has(PERMISSIONS.PROFILE.MANAGE_2FA),
            managePasskeys: has(PERMISSIONS.PROFILE.MANAGE_PASSKEYS),
            manageSso: has(PERMISSIONS.PROFILE.MANAGE_SSO),
            seeGroups: has(PERMISSIONS.GROUPS.READ),
        },
    };
}
