/**
 * What the login page shows before anyone signs in: the name of the instance, its picture or the
 * logos of every adapter, the providers to sign in with and whether anyone has an account yet. The
 * page is public, so this reads only what it shows, never a secret of a provider.
 *
 * Only the providers of the platform are buttons. A provider of a tenant is reached by the domain
 * of an email, which `findDomainProvider` answers for one domain at a time, so the page never
 * lists which customers have a provider of their own, nor their domains or tenants.
 */

import prisma from "@/lib/prisma";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { getOidcAutoRedirectProviderId, isEmailLoginDisabled } from "@/lib/auth/env-flags";
import type { PasswordRules } from "@/lib/auth/password-policy";
import { isEmailDomain, normalizeDomain } from "@/lib/auth/sso-domain";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
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

/** The provider an email domain reaches, as the login page needs it to say so and to go there. */
export type DomainProvider = Pick<LoginProvider, "providerId" | "name" | "adapterId" | "domain" | "allowProvisioning">;

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
    /** The providers of the platform that are on, each a button. */
    providers: LoginProvider[];
    /**
     * A provider of a tenant that is on claims a domain, so the email comes first and the page asks
     * the server where it goes. Says nothing about which domains.
     */
    domainRouting: boolean;
    passkeyLogin: boolean;
    /** DISABLE_EMAIL_LOGIN is not set on the container. */
    emailLogin: boolean;
    /** OIDC_AUTO_REDIRECT names an enabled provider. */
    autoRedirectProviderId: string | null;
    /** What the password of the first account needs, null once anyone has an account. */
    passwordRules: PasswordRules | null;
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
    const [userCount, providers, tenantDomains, passkeyOff, name, picture] = await Promise.all([
        prisma.user.count(),
        prisma.ssoProvider.findMany({
            where: { enabled: true, tenantId: null },
            orderBy: { name: "asc" },
            select: { id: true, providerId: true, name: true, adapterId: true, domain: true, allowProvisioning: true, issuer: true },
        }),
        // Whether any is there, never which.
        prisma.ssoProvider.count({ where: { enabled: true, tenantId: { not: null }, domain: { not: null } } }),
        prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" }, select: { value: true } }),
        prisma.systemSetting.findUnique({ where: { key: "general.instanceName" }, select: { value: true } }),
        getLoginPicture(),
    ]);

    // The page is public, so the rules show only to whoever creates the first account.
    const passwordRules = userCount === 0 ? await getPasswordPolicy() : null;
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
        domainRouting: tenantDomains > 0,
        passkeyLogin: passkeyOff?.value !== "true",
        emailLogin: !isEmailLoginDisabled(),
        autoRedirectProviderId: redirectTo && loginProviders.some((provider) => provider.providerId === redirectTo) ? redirectTo : null,
        passwordRules,
    };
}

/**
 * The provider that is on and claims the domain of an email, of the platform or of a tenant, for
 * the login page while someone types. It answers for one domain only and never names a tenant.
 */
export async function findDomainProvider(value: string): Promise<DomainProvider | null> {
    const domain = normalizeDomain(value);
    if (!domain || !isEmailDomain(domain)) return null;
    // Few providers claim a domain, and one saved before domains were kept in lowercase still counts.
    const claimed = await prisma.ssoProvider.findMany({
        where: { enabled: true, domain: { not: null } },
        orderBy: { name: "asc" },
        select: { providerId: true, name: true, adapterId: true, domain: true, allowProvisioning: true },
    });
    const found = claimed.find((provider) => normalizeDomain(provider.domain) === domain);
    return found ? { ...found, domain } : null;
}
