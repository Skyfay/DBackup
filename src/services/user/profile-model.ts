/**
 * The model of the Profile page: every part of the signed-in user read at once, so the navigation
 * shows the state of each and a part opens without loading.
 */

import prisma from "@/lib/prisma";
import { accessSentences, summarizeAccess } from "@/lib/auth/access-summary";
import { PERMISSIONS } from "@/lib/auth/permissions";
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
    group: { id: string; name: string } | null;
    /** What the group lets the user do, in up to three sentences. */
    access: string[];
    /** Signs in with a password, so the password and the authenticator app apply. */
    hasPassword: boolean;
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

export async function getProfileModel(userId: string, viewer: { permissions: string[]; isSuperAdmin: boolean }): Promise<ProfileModel> {
    const { permissions, isSuperAdmin } = viewer;
    const [user, hasPassword, providers, linked, sessions, colors] = await Promise.all([
        prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: {
                id: true, name: true, email: true, image: true, timezone: true, dateFormat: true, timeFormat: true,
                autoRedirectOnJobStart: true, twoFactorEnabled: true, passkeyTwoFactor: true, group: { select: { id: true, name: true } },
            },
        }),
        prisma.account.count({ where: { userId, providerId: "credential" } }).then((count) => count > 0),
        prisma.ssoProvider.count(),
        prisma.account.count({ where: { userId, NOT: { providerId: "credential" } } }),
        prisma.session.count({ where: { userId, expiresAt: { gt: new Date() } } }),
        getTaskColors(userId),
    ]);
    const has = (permission: string) => isSuperAdmin || permissions.includes(permission);
    const { group, ...rest } = user;

    return {
        user: { ...rest, twoFactorEnabled: !!rest.twoFactorEnabled, passkeyTwoFactor: !!rest.passkeyTwoFactor },
        group,
        access: accessSentences(summarizeAccess(permissions, isSuperAdmin)),
        hasPassword,
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
