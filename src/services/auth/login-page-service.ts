/**
 * What the login page shows before anyone signs in: the name of the instance, its picture or the
 * logos of every adapter, the providers to sign in with and whether anyone has an account yet. The
 * page is public, so this reads only what it shows, never a secret of a provider.
 */

import prisma from "@/lib/prisma";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { getOidcAutoRedirectProviderId, isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { getLoginPicture } from "@/services/system/login-image-service";

export interface LoginProvider {
    id: string;
    providerId: string;
    name: string;
    adapterId: string;
    /** Emails of this domain sign in with the provider. */
    domain: string | null;
    allowProvisioning: boolean;
    /** Where the provider lives, for the page that waits for it. */
    host: string | null;
}

export interface LoginAdapters {
    databases: string[];
    storage: string[];
    notifications: string[];
}

export interface LoginPageModel {
    /** Nobody has an account yet, so the page offers a first account or a restore. */
    firstStart: boolean;
    instanceName: string | null;
    picture: { src: string } | null;
    adapters: LoginAdapters;
    providers: LoginProvider[];
    passkeyLogin: boolean;
    /** DISABLE_EMAIL_LOGIN is not set on the container. */
    emailLogin: boolean;
    /** OIDC_AUTO_REDIRECT names an enabled provider. */
    autoRedirectProviderId: string | null;
}

function hostOf(issuer: string | null): string | null {
    if (!issuer) return null;
    try {
        return new URL(issuer).host;
    } catch {
        return null;
    }
}

/** Every adapter by its kind, in the order of the definitions. All of them, never the ones this instance uses. */
export function loginAdapters(): LoginAdapters {
    const of = (type: string) => ADAPTER_DEFINITIONS.filter((definition) => definition.type === type).map((definition) => definition.id);
    return { databases: of("database"), storage: of("storage"), notifications: of("notification") };
}

export async function getLoginPageModel(): Promise<LoginPageModel> {
    const [userCount, providers, passkeyOff, name, picture] = await Promise.all([
        prisma.user.count(),
        prisma.ssoProvider.findMany({
            where: { enabled: true },
            orderBy: { name: "asc" },
            select: { id: true, providerId: true, name: true, adapterId: true, domain: true, allowProvisioning: true, issuer: true },
        }),
        prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" }, select: { value: true } }),
        prisma.systemSetting.findUnique({ where: { key: "general.instanceName" }, select: { value: true } }),
        getLoginPicture(),
    ]);

    const loginProviders = providers.map(({ issuer, ...provider }) => ({ ...provider, host: hostOf(issuer) }));
    // A value that matches no enabled provider means no redirect. startup-checks.ts reports it, so a
    // provider deleted after the start degrades instead of locking everyone out.
    const redirectTo = getOidcAutoRedirectProviderId();
    return {
        firstStart: userCount === 0,
        instanceName: name?.value.trim() || null,
        picture,
        adapters: loginAdapters(),
        providers: loginProviders,
        passkeyLogin: passkeyOff?.value !== "true",
        emailLogin: !isEmailLoginDisabled(),
        autoRedirectProviderId: redirectTo && loginProviders.some((provider) => provider.providerId === redirectTo) ? redirectTo : null,
    };
}
