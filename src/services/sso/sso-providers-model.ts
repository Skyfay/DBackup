import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getOidcAutoRedirectProviderId, isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { groupPermissions } from "@/lib/auth/owner-permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { membersOfAny } from "@/services/tenant/membership-service";
import { CREDENTIAL_PROVIDER } from "@/services/user/users-model";
import { OIDC_ADAPTERS } from "./oidc-registry";
import { configOf, placeOf, ssoCallbackBase } from "./sso-provider-config";
import type { SsoPerson, SsoProviderRow, SsoProvidersModel, SsoTenant } from "./sso-providers-types";

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
    tenantId: true,
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
    fullAccess: boolean;
    /** The tenant of the group, where all of its members work. */
    tenantId: string;
    _count: { memberships: number };
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

interface BuildInput {
    providers: ListedProvider[];
    people: ListedPerson[];
    groups: ListedGroup[];
    signIns: number;
    passwordSignIn: boolean;
    passkeys: boolean;
    autoRedirect: string | null;
    callbackBase: string;
    /** The tenants the providers belong to, the home tenant among them. */
    tenants: SsoTenant[];
    /** Whether the viewer changes the providers, which only a platform admin does. */
    canManage: boolean;
}

const byNewestSignIn = (a: SsoPerson, b: SsoPerson) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? "") || a.name.localeCompare(b.name);

/** The home tenant first, then the others by name. */
const homeFirst = (a: SsoTenant, b: SsoTenant) => Number(b.id === HOME_TENANT_ID) - Number(a.id === HOME_TENANT_ID) || a.name.localeCompare(b.name);

/** The SSO tab: every provider with who is linked through it, where it belongs, and the numbers above the list. */
export function buildSsoProvidersModel(input: BuildInput): SsoProvidersModel {
    const { providers, people, groups, signIns, passwordSignIn, passkeys, autoRedirect, callbackBase, canManage } = input;
    const ways: SignInWays = { passwordSignIn, passkeys, enabled: new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.providerId, provider.name])) };
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const tenants = [...input.tenants].sort(homeFirst);
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const home = tenantById.get(HOME_TENANT_ID) ?? { id: HOME_TENANT_ID, name: "Home" };

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
            const tenant = provider.tenantId ? tenantById.get(provider.tenantId) ?? { id: provider.tenantId, name: provider.tenantId } : null;
            const landsIn = tenant ?? home;
            // Only a group of the tenant new people land in counts, any other places them nowhere.
            const found = provider.defaultGroupId ? groupById.get(provider.defaultGroupId) : undefined;
            const group = found && found.tenantId === landsIn.id ? found : undefined;
            return {
                id: provider.id,
                providerId: provider.providerId,
                name: provider.name,
                adapterId: provider.adapterId,
                enabled: provider.enabled,
                host: place.host,
                hostDetail: place.detail,
                domain: provider.domain || null,
                tenant,
                landsIn,
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
            onLoginPage: rows.filter((row) => row.enabled && !row.tenant).map((row) => row.name),
            tenantsWithOwn: new Set(rows.flatMap((row) => (row.tenant ? [row.tenant.id] : []))).size,
            byEmail: [...new Set(rows.flatMap((row) => (row.enabled && row.tenant && row.domain ? [row.domain] : [])))].sort((a, b) => a.localeCompare(b)),
        },
        passwordSignIn,
        passkeys,
        autoRedirect,
        callbackBase,
        adapters: OIDC_ADAPTERS.map((adapter) => ({ id: adapter.id, name: adapter.name, inputs: adapter.inputs })),
        tenants: canManage ? tenants : tenants.filter((tenant) => tenant.id === HOME_TENANT_ID),
        manage: canManage
            ? {
                  groups: groups.map((group) => ({
                      id: group.id,
                      tenantId: group.tenantId,
                      name: group.name,
                      superAdmin: group.fullAccess,
                      permissions: groupPermissions(group),
                      members: group._count.memberships,
                  })),
              }
            : null,
    };
}

/**
 * Whose providers the tab lists: every one, or for someone of a platform group of some tenants those
 * of the platform and of the tenants it reaches, with only the people of those tenants beside them.
 */
export interface SsoProvidersScope {
    reach: PlatformReach;
    /** The viewer, who sees their own account among the people in any case. */
    viewerId: string | null;
}

const EVERY_PROVIDER: SsoProvidersScope = { reach: "all", viewerId: null };

/**
 * The accounts a viewer of some tenants sees: those with a membership in a tenant they reach, like
 * the accounts of the platform show them (`membersOfAny`), and their own.
 */
function peopleReached(reached: readonly string[], viewerId: string | null): Prisma.UserWhereInput {
    return { OR: [...(viewerId ? [{ id: viewerId }] : []), membersOfAny(reached)] };
}

/**
 * Loads the SSO tab. The client secret never leaves the database. A platform admin sees the
 * providers of every tenant with the groups of every tenant, read as the system since the admin
 * may work inside any tenant. Anyone else sees the providers of the platform only. A scope of some
 * tenants narrows it to the providers of the platform and of those tenants, the groups they name
 * and the accounts that work there, see `SsoProvidersScope`.
 */
export async function getSsoProvidersModel(canManage: boolean, scope: SsoProvidersScope = EVERY_PROVIDER): Promise<SsoProvidersModel> {
    const since = new Date(Date.now() - SIGN_IN_WINDOW_MS);
    const reached = scope.reach === "all" ? null : scope.reach;
    return runAsSystem(async () => {
        const [providers, tenants, passkeySetting] = await Promise.all([
            prisma.ssoProvider.findMany({
                where: !canManage ? { tenantId: null } : reached ? { OR: [{ tenantId: null }, { tenantId: { in: [...reached] } }] } : undefined,
                select: PROVIDER_SELECT,
            }),
            prisma.tenant.findMany({
                where: !canManage ? { id: HOME_TENANT_ID } : reached ? { id: { in: [HOME_TENANT_ID, ...reached] } } : undefined,
                select: { id: true, name: true },
            }),
            prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" }, select: { value: true } }),
        ]);
        // The groups of the tenants reached, and those the providers of the platform place people in.
        const platformGroups = providers.flatMap((provider) => (!provider.tenantId && provider.defaultGroupId ? [provider.defaultGroupId] : []));
        const groups = await prisma.group.findMany({
            // A group belongs to one tenant, so all of its memberships are in that tenant.
            where: !canManage ? { tenantId: HOME_TENANT_ID } : reached ? { OR: [{ tenantId: { in: [...reached] } }, { id: { in: platformGroups } }] } : undefined,
            select: { id: true, name: true, permissions: true, fullAccess: true, tenantId: true, _count: { select: { memberships: true } } },
            orderBy: { name: "asc" },
        });
        const people = providers.length === 0
            ? []
            : await prisma.user.findMany({
                  where: {
                      accounts: { some: { providerId: { in: providers.map((provider) => provider.providerId) } } },
                      ...(reached ? peopleReached(reached, scope.viewerId) : {}),
                  },
                  select: {
                      id: true,
                      name: true,
                      email: true,
                      image: true,
                      accounts: { select: { providerId: true, updatedAt: true } },
                      _count: { select: { passkeys: true } },
                  },
              });
        // The sign-in entries keep their method in the details, written as JSON without spaces. A
        // sign-in belongs to no tenant, the count covers them all, or the people shown.
        const signIns = await prisma.auditLog.count({
            where: {
                action: AUDIT_ACTIONS.LOGIN,
                createdAt: { gte: since },
                details: { contains: '"method":"sso"' },
                ...(reached ? { userId: { in: people.map((person) => person.id) } } : {}),
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
            tenants,
            canManage,
        });
    });
}
