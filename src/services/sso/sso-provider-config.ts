import type { SsoProvider } from "@prisma/client";
import { getOIDCAdapter } from "./oidc-registry";

/**
 * What the SSO tab reads of the fields of a provider: the fields of its type as saved, without a
 * password, and where people sign in. Plain functions over a row, so the model and its tests share them.
 */

type ConfigSource = Pick<SsoProvider, "adapterId" | "adapterConfig" | "issuer" | "authorizationEndpoint" | "tokenEndpoint" | "userInfoEndpoint" | "jwksEndpoint">;

function parseConfig(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const trimmed = (value: string) => value.replace(/\/+$/, "");

/** The fields of a provider saved before they were kept, read back from its issuer. */
function legacyConfig(provider: Omit<ConfigSource, "adapterConfig">): Record<string, string> {
    const issuer = provider.issuer;
    if (!issuer) return {};
    if (provider.adapterId === "keycloak" && issuer.includes("/realms/")) {
        const [baseUrl, realm] = issuer.split("/realms/");
        return { baseUrl, realm: trimmed(realm) };
    }
    if (provider.adapterId === "authentik" && issuer.includes("/application/o/")) {
        const [baseUrl, slug] = issuer.split("/application/o/");
        return { baseUrl, slug: trimmed(slug) };
    }
    if (provider.adapterId === "pocket-id" || provider.adapterId === "authelia") return { baseUrl: issuer };
    if (provider.adapterId === "generic") {
        const fields = { issuer, authorizationEndpoint: provider.authorizationEndpoint, tokenEndpoint: provider.tokenEndpoint, userInfoEndpoint: provider.userInfoEndpoint, jwksEndpoint: provider.jwksEndpoint };
        return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
    return {};
}

/** The fields of the provider type as saved, without a field that is a password. */
export function configOf(provider: ConfigSource): Record<string, string> {
    const secret = new Set((getOIDCAdapter(provider.adapterId)?.inputs ?? []).filter((input) => input.type === "password").map((input) => input.name));
    const saved = Object.entries(parseConfig(provider.adapterConfig)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !secret.has(entry[0]));
    return saved.length > 0 ? Object.fromEntries(saved) : legacyConfig(provider);
}

function hostOf(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        return new URL(url).host;
    } catch {
        return null;
    }
}

/** Where people sign in: the host, and what the provider type adds to it. */
export function placeOf(adapterId: string, config: Record<string, string>, issuer: string | null): { host: string | null; detail: string | null } {
    const host = hostOf(config.baseUrl) ?? hostOf(config.issuer) ?? hostOf(issuer);
    if (adapterId === "authentik" && config.slug) return { host, detail: `application ${config.slug}` };
    if (adapterId === "keycloak" && config.realm) return { host, detail: `realm ${config.realm}` };
    return { host, detail: null };
}

/** The address of DBackup that better-auth builds every callback URL from. */
export function ssoCallbackBase(): string {
    return `${trimmed(process.env.BETTER_AUTH_URL || "http://localhost:3000")}/api/auth/sso/callback/`;
}
