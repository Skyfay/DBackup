import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getOidcAutoRedirectProviderId, isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { groupPermissions } from "@/lib/auth/owner-permissions";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { CREDENTIAL_PROVIDER, SUPER_ADMIN_GROUP } from "@/services/user/users-model";
import { getOIDCAdapter, OIDC_ADAPTERS } from "./oidc-registry";
import type { SsoPerson, SsoProviderRow, SsoProvidersModel } from "./sso-providers-types";

/** The window of the sign-ins above the list. */
const SIGN_IN_WINDOW_MS = 30 * 86_400_000;

/**
 * What the tab reads of a provider. The client secret, and the config better-auth reads that holds
 * it too, never leave the database.
 */
export const PROVIDER_SELECT = {
    id: true,
    providerId: true,
    name: true,
    adapterId: true,
    enabled: true,
    domain: true,
    clientId: true,
    adapterConfig: true,
    issuer: true,
    authorizationEndpoint: true,
    tokenEndpoint: true,
    userInfoEndpoint: true,
    jwksEndpoint: true,
    allowProvisioning: true,
    defaultGroupId: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.SsoProviderSelect;

export type ListedProvider = Prisma.SsoProviderGetPayload<{ select: typeof PROVIDER_SELECT }>;

export interface ListedPerson {
    id: string;
    name: string;
    email: string;
    image: string | null;
    /** Each sign-in through a provider writes its link again, so the time is the last sign-in. */
    accounts: { providerId: string; updatedAt: Date }[];
    _count: { passkeys: number };
}

export interface ListedGroup {
    id: string;
    name: string;
    permissions: string;
    _count: { users: number };
}

/** The ways to sign in that are on, which decide who still gets in without a provider. */
export interface SignInWays {
    passwordSignIn: boolean;
    passkeys: boolean;
    /** The providers that are on, by provider ID, with their names. */
    enabled: Map<string, string>;
}

/** How else someone signs in right now, besides the provider, like "a password" or "Pocket ID". */
export function otherWaysOf(person: Pick<ListedPerson, "accounts" | "_count">, providerId: string, ways: SignInWays): string[] {
    const found: string[] = [];
    if (ways.passwordSignIn && person.accounts.some((account) => account.providerId === CREDENTIAL_PROVIDER)) found.push("a password");
    if (ways.passkeys && person._count.passkeys > 0) found.push(person._count.passkeys === 1 ? "a passkey" : `${person._count.passkeys} passkeys`);
    for (const account of person.accounts) {
        if (account.providerId === CREDENTIAL_PROVIDER || account.providerId === providerId) continue;
        const name = ways.enabled.get(account.providerId);
        if (name && !found.includes(name)) found.push(name);
    }
    return found;
}

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
function legacyConfig(provider: Pick<ListedProvider, "adapterId" | "issuer" | "authorizationEndpoint" | "tokenEndpoint" | "userInfoEndpoint" | "jwksEndpoint">): Record<string, string> {
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
export function configOf(provider: Pick<ListedProvider, "adapterId" | "adapterConfig" | "issuer" | "authorizationEndpoint" | "tokenEndpoint" | "userInfoEndpoint" | "jwksEndpoint">): Record<string, string> {
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

interface BuildInput {
    providers: ListedProvider[];
    people: ListedPerson[];
    groups: ListedGroup[];
    signIns: number;
    passwordSignIn: boolean;
    passkeys: boolean;
    autoRedirect: string | null;
    callbackBase: string;
    /** Who looks, when they may change the providers. */
    manager: { superAdmin: boolean; permissions: string[] } | null;
}

const byNewestSignIn = (a: SsoPerson, b: SsoPerson) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? "") || a.name.localeCompare(b.name);

/** The Sign-in tab: every provider with who is linked through it, and the numbers above the list. */
export function buildSsoProvidersModel(input: BuildInput): SsoProvidersModel {
    const { providers, people, groups, signIns, passwordSignIn, passkeys, autoRedirect, callbackBase, manager } = input;
    const ways: SignInWays = { passwordSignIn, passkeys, enabled: new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.providerId, provider.name])) };
    const groupById = new Map(groups.map((group) => [group.id, group]));

    const rows: SsoProviderRow[] = providers
        .map((provider) => {
            const config = configOf(provider);
            const place = placeOf(provider.adapterId, config, provider.issuer);
            const linked = people
                .filter((person) => person.accounts.some((account) => account.providerId === provider.providerId))
                .map((person): SsoPerson => {
                    const account = person.accounts.find((entry) => entry.providerId === provider.providerId);
                    return {
                        id: person.id,
                        name: person.name,
                        email: person.email,
                        image: person.image,
                        lastSignInAt: account?.updatedAt.toISOString() ?? null,
                        otherWays: otherWaysOf(person, provider.providerId, ways),
                    };
                })
                .sort(byNewestSignIn);
            const last = linked.find((person) => person.lastSignInAt);
            const group = provider.defaultGroupId ? groupById.get(provider.defaultGroupId) : undefined;
            return {
                id: provider.id,
                providerId: provider.providerId,
                name: provider.name,
                adapterId: provider.adapterId,
                enabled: provider.enabled,
                host: place.host,
                hostDetail: place.detail,
                domain: provider.domain || null,
                clientId: provider.clientId,
                config,
                endpoints: {
                    issuer: provider.issuer,
                    authorization: provider.authorizationEndpoint,
                    token: provider.tokenEndpoint,
                    userInfo: provider.userInfoEndpoint,
                    jwks: provider.jwksEndpoint,
                },
                allowProvisioning: provider.allowProvisioning,
                group: group ? { id: group.id, name: group.name } : null,
                linked,
                lastSignIn: last?.lastSignInAt ? { at: last.lastSignInAt, name: last.name } : null,
                createdAt: provider.createdAt.toISOString(),
                updatedAt: provider.updatedAt.toISOString(),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    // Someone linked through a provider who has neither a password nor a passkey that works.
    const only = people.filter((person) => otherWaysOf(person, "", { ...ways, enabled: new Map() }).length === 0);

    return {
        providers: rows,
        stats: {
            providers: rows.length,
            enabled: rows.filter((row) => row.enabled).length,
            disabled: rows.filter((row) => !row.enabled).map((row) => row.name),
            linked: people.length,
            linkedBy: rows.filter((row) => row.linked.length > 0).map((row) => ({ name: row.name, count: row.linked.length })).sort((a, b) => b.count - a.count),
            onlyThrough: only.map((person) => person.name).sort((a, b) => a.localeCompare(b)),
            signIns,
        },
        passwordSignIn,
        passkeys,
        autoRedirect,
        callbackBase,
        adapters: OIDC_ADAPTERS.map((adapter) => ({ id: adapter.id, name: adapter.name, inputs: adapter.inputs })),
        manage: manager
            ? {
                  groups: groups.map((group) => ({
                      id: group.id,
                      name: group.name,
                      superAdmin: group.name === SUPER_ADMIN_GROUP,
                      permissions: groupPermissions(group),
                      members: group._count.users,
                  })),
                  superAdmin: manager.superAdmin,
                  permissions: manager.permissions,
              }
            : null,
    };
}

/** Loads the Sign-in tab. The client secret never leaves the database. */
export async function getSsoProvidersModel(manager: BuildInput["manager"]): Promise<SsoProvidersModel> {
    const since = new Date(Date.now() - SIGN_IN_WINDOW_MS);
    const [providers, groups, signIns, passkeySetting] = await Promise.all([
        prisma.ssoProvider.findMany({ select: PROVIDER_SELECT }),
        prisma.group.findMany({ select: { id: true, name: true, permissions: true, _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
        // The sign-in entries keep their method in the details, written as JSON without spaces.
        prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.LOGIN, createdAt: { gte: since }, details: { contains: '"method":"sso"' } } }),
        prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" }, select: { value: true } }),
    ]);
    const people = providers.length === 0
        ? []
        : await prisma.user.findMany({
              where: { accounts: { some: { providerId: { in: providers.map((provider) => provider.providerId) } } } },
              select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                  accounts: { select: { providerId: true, updatedAt: true } },
                  _count: { select: { passkeys: true } },
              },
          });

    return buildSsoProvidersModel({
        providers,
        people,
        groups,
        signIns,
        passwordSignIn: !isEmailLoginDisabled(),
        passkeys: passkeySetting?.value !== "true",
        autoRedirect: getOidcAutoRedirectProviderId(),
        callbackBase: ssoCallbackBase(),
        manager,
    });
}
