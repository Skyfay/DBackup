/**
 * What the SSO tab of the Users & Groups page shows: every provider with the people linked
 * through it, its last sign-in and what happens to new people. Plain data, so the browser can
 * import it without the services behind it. Never the client secret.
 */

import type { OIDCInput } from "@/lib/core/oidc-adapter";

/** Someone linked through a provider. */
export interface SsoPerson {
    id: string;
    name: string;
    email: string;
    image: string | null;
    /** When they last signed in through this provider, since each sign-in writes the link again. */
    lastSignInAt: string | null;
    /** How else they sign in right now, like "a password" or "Pocket ID". Empty when this provider is their only way in. */
    otherWays: string[];
}

export interface SsoEndpoints {
    issuer: string | null;
    authorization: string | null;
    token: string | null;
    userInfo: string | null;
    jwks: string | null;
}

export interface SsoProviderRow {
    id: string;
    /** Part of the callback URL, so it never changes once saved. */
    providerId: string;
    name: string;
    adapterId: string;
    enabled: boolean;
    /** Where people sign in, the host of the provider. */
    host: string | null;
    /** What the provider type adds to the host, like "realm test". */
    hostDetail: string | null;
    /** An email of this domain goes straight to the provider from the login page. */
    domain: string | null;
    clientId: string | null;
    /** The fields of the provider type as saved, for Edit. Never a field that is a password. */
    config: Record<string, string>;
    endpoints: SsoEndpoints;
    /** Adds someone on their first sign-in. */
    allowProvisioning: boolean;
    /** The group new people start in. */
    group: { id: string; name: string } | null;
    linked: SsoPerson[];
    lastSignIn: { at: string; name: string } | null;
    createdAt: string;
    updatedAt: string;
}

export interface SsoProvidersStats {
    providers: number;
    enabled: number;
    /** Names of the disabled providers. */
    disabled: string[];
    /** Everyone linked through a provider, each counted once. */
    linked: number;
    /** How many each provider links, for the line under the number. */
    linkedBy: { name: string; count: number }[];
    /** Names of the people with no password and no passkey, who sign in only through a provider. */
    onlyThrough: string[];
    /** Sign-ins through a provider in the last 30 days. */
    signIns: number;
}

/** A group new people of a provider can start in. */
export interface SsoGroupOption {
    id: string;
    name: string;
    superAdmin: boolean;
    permissions: string[];
    members: number;
}

/** A provider type with the fields it asks for. */
export interface SsoAdapterOption {
    id: string;
    name: string;
    inputs: OIDCInput[];
}

export interface SsoProvidersModel {
    providers: SsoProviderRow[];
    stats: SsoProvidersStats;
    /** Whether people may sign in with a password, which DISABLE_EMAIL_LOGIN turns off. */
    passwordSignIn: boolean;
    /** Whether people may sign in with a passkey, a setting of DBackup. */
    passkeys: boolean;
    /** The provider OIDC_AUTO_REDIRECT sends the login page to. */
    autoRedirect: string | null;
    /** Every callback URL starts with this, the address of DBackup better-auth knows. */
    callbackBase: string;
    adapters: SsoAdapterOption[];
    /** For a SuperAdmin, the only one who changes the providers: the groups new people can start in. */
    manage: { groups: SsoGroupOption[] } | null;
}

/** The address a provider sends people back to after they signed in. */
export const callbackUrl = (base: string, providerId: string) => `${base}${providerId}`;
