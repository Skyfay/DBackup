import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { attentionOf, type TabAttention } from "@/lib/core/tab-attention";
import { parseUserAgent } from "@/lib/core/user-agent";
import { SOON_MS } from "@/services/auth/api-keys-types";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { peopleOf, roleIn } from "@/services/tenant/membership-service";
import type { SecondFactor, SignInMethod, UserRow, UserSignIn, UsersGroup, UsersModel, UserTenantRole } from "./users-types";

/** The window of Signed in above the list. */
const SIGNED_IN_WINDOW_MS = 30 * 86_400_000;

/** The account Better Auth keeps the password in. */
export const CREDENTIAL_PROVIDER = "credential";

/** A session or a sign-in, from the fields both have. */
export interface SignInSource {
    createdAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
}

export interface ListedSession extends SignInSource {
    expiresAt: Date;
}

export interface ListedUser {
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt: Date;
    twoFactorEnabled: boolean | null;
    passkeyTwoFactor: boolean | null;
    platformRole: string | null;
    /** The platform group of the account, which only someone of the platform changes. */
    platformGroupId?: string | null;
    /** The membership in the tenant the list is for, none or one. In All tenants every one, with its tenant. */
    memberships: { tenantId?: string; group: { id: string; name: string } }[];
    accounts: { providerId: string }[];
    sessions: ListedSession[];
    /** The memberships counted are the ones in other tenants. */
    _count: { apiKeys: number; passkeys: number; memberships?: number };
}

export interface ListedGroup {
    id: string;
    name: string;
    permissions: string;
    fullAccess: boolean;
    /** The tenant of the group, for the list of every account. */
    tenantId?: string;
    /** Members in the tenant the list is for. */
    _count: { memberships: number };
}

export interface ListedProvider {
    providerId: string;
    name: string;
    adapterId: string | null;
}

/**
 * A session a browser holds. Creating a user through Better Auth on the server opens a session
 * without a browser, which nobody ever holds, so the list leaves those out.
 */
export const heldByBrowser = (session: { userAgent: string | null }) => Boolean(session.userAgent?.trim());

/** "unknown" is what the sign-in entry of the audit log writes for a missing header. */
const known = (value: string | null) => (value && value.trim() && value !== "unknown" ? value : null);

export function signInOf(source: SignInSource): UserSignIn {
    const agent = known(source.userAgent);
    return { at: source.createdAt.toISOString(), agent: agent ? parseUserAgent(agent) : null, ip: known(source.ipAddress) };
}

export function parsePermissions(json: string): string[] {
    try {
        const value: unknown = JSON.parse(json);
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

export function methodsOf(user: Pick<ListedUser, "accounts" | "_count">, providers: Map<string, ListedProvider>): SignInMethod[] {
    const sso = user.accounts
        .filter((account) => account.providerId !== CREDENTIAL_PROVIDER)
        .map((account): SignInMethod => {
            const provider = providers.get(account.providerId);
            return { kind: "sso", providerId: account.providerId, name: provider?.name ?? account.providerId, adapterId: provider?.adapterId ?? null };
        });
    return [
        ...(user.accounts.some((account) => account.providerId === CREDENTIAL_PROVIDER) ? [{ kind: "password" } as const] : []),
        ...(user._count.passkeys > 0 ? [{ kind: "passkey", count: user._count.passkeys } as const] : []),
        ...sso,
    ];
}

export function secondFactorOf(user: Pick<ListedUser, "twoFactorEnabled" | "passkeyTwoFactor">, methods: SignInMethod[]): SecondFactor {
    // Turning on the passkey as second factor sets the flag of the app too, so it comes first.
    if (user.passkeyTwoFactor) return "passkey";
    if (user.twoFactorEnabled) return "app";
    if (methods.some((method) => method.kind === "password")) return "none";
    return methods.some((method) => method.kind === "sso") ? "sso" : "no-password";
}

/** The newer of the last sign-in the audit log knows and the newest session a browser opened. */
export function lastSignInOf(login: SignInSource | undefined, sessions: SignInSource[]): UserSignIn | null {
    const newest = sessions.filter(heldByBrowser).reduce<SignInSource | undefined>((best, session) => (!best || session.createdAt > best.createdAt ? session : best), undefined);
    const pick = !login ? newest : !newest ? login : newest.createdAt > login.createdAt ? newest : login;
    return pick ? signInOf(pick) : null;
}

interface BuildInput {
    users: ListedUser[];
    groups: ListedGroup[];
    providers: ListedProvider[];
    /** The newest sign-in entry of the audit log per user. */
    logins: Map<string, SignInSource>;
    viewerId: string | null;
    viewerPlatformAdmin: boolean;
    /** Every account of the instance with all its memberships, for All tenants. */
    allTenants?: boolean;
    now?: number;
}

/** The tenants of an account with its group in each, from all its memberships. */
function tenantsOf(user: Pick<ListedUser, "memberships">): UserTenantRole[] {
    return user.memberships.flatMap((membership) => (membership.tenantId ? [{ tenantId: membership.tenantId, group: { id: membership.group.id, name: membership.group.name } }] : []));
}

/**
 * The Users tab: the people of a tenant with how they sign in, and the numbers above the list. In
 * All tenants every account with the group it holds in each of its tenants, where an account of
 * no tenant is the one that sees nothing.
 */
export function buildUsersModel({ users, groups, providers, logins, viewerId, viewerPlatformAdmin, allTenants = false, now = Date.now() }: BuildInput): Omit<UsersModel, "passwordPolicy" | "homeTenant"> {
    const providerMap = new Map(providers.map((provider) => [provider.providerId, provider]));
    const devices = new Set<string>();
    let sessions = 0;

    const rows: UserRow[] = users.map((user) => {
        const methods = methodsOf(user, providerMap);
        const open = user.sessions.filter((session) => heldByBrowser(session) && session.expiresAt.getTime() > now);
        sessions += open.length;
        for (const session of open) {
            const agent = parseUserAgent(session.userAgent);
            devices.add(`${user.id}|${agent.browser}|${agent.os}|${agent.device}`);
        }
        const group = allTenants ? undefined : user.memberships[0]?.group;
        const tenants = allTenants ? tenantsOf(user) : undefined;
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            group: group ? { id: group.id, name: group.name } : null,
            ...(tenants ? { tenants } : {}),
            superAdmin: user.platformRole === PLATFORM_ADMIN_ROLE,
            // An account of a platform group belongs to the platform as well, see `accountRefusal`.
            elsewhere: (tenants ? tenants.length > 1 : (user._count.memberships ?? 0) > 0) || !!user.platformGroupId,
            methods,
            secondFactor: secondFactorOf(user, methods),
            lastSignIn: lastSignInOf(logins.get(user.id), user.sessions),
            sessions: open.length,
            apiKeys: user._count.apiKeys,
            isYou: user.id === viewerId,
        };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const groupRows: UsersGroup[] = groups
        .map((group) => ({
            id: group.id,
            name: group.name,
            ...(group.tenantId ? { tenantId: group.tenantId } : {}),
            members: group._count.memberships,
            permissions: parsePermissions(group.permissions),
            superAdmin: group.fullAccess,
        }))
        // The group with every permission first, then by name, like the choice in New user.
        .sort((a, b) => Number(b.superAdmin) - Number(a.superAdmin) || a.name.localeCompare(b.name));

    const passwordOnly = rows.filter((row) => row.secondFactor === "none").map((row) => row.name);
    // In All tenants an account sees something once it works in some tenant, or runs the platform
    // as a platform admin or with a platform group, which needs no tenant.
    const placed = (row: UserRow) => (row.tenants ? row.tenants.length > 0 || row.superAdmin || Boolean(row.platformGroup) : row.group !== null);
    return {
        users: rows,
        groups: groupRows,
        stats: {
            users: rows.length,
            inGroup: rows.filter(placed).length,
            withoutGroup: rows.filter((row) => !placed(row)).map((row) => row.name),
            passwordOnly,
            protected: rows.length - passwordOnly.length,
            signedIn: rows.filter((row) => row.lastSignIn && now - Date.parse(row.lastSignIn.at) <= SIGNED_IN_WINDOW_MS).length,
            never: rows.filter((row) => !row.lastSignIn).map((row) => row.name),
            sessions,
            devices: devices.size,
        },
        viewerPlatformAdmin,
        allTenants,
    };
}

/**
 * The newest sign-in the audit log knows per user. A sign-in belongs to the account and is written
 * into the home tenant, so it is read for these people alone, in every tenant.
 */
export async function loadLogins(userIds: string[]): Promise<Map<string, SignInSource>> {
    // One entry per user, the newest, since the rows come newest first.
    const logins = await runAsSystem(() => prisma.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.LOGIN, userId: { in: userIds } },
        orderBy: { createdAt: "desc" },
        distinct: ["userId"],
        select: { userId: true, createdAt: true, userAgent: true, ipAddress: true },
    }));
    return new Map(logins.flatMap((login) => (login.userId ? [[login.userId, login] as const] : [])));
}

/** Loads the Users tab of a tenant. The password hashes of the accounts never leave the database. */
export async function getUsersModel(viewerId: string | null, viewerPlatformAdmin: boolean, tenantId: string): Promise<UsersModel> {
    const [users, groups, providers, passwordPolicy] = await Promise.all([
        prisma.user.findMany({
            where: peopleOf(tenantId),
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                createdAt: true,
                twoFactorEnabled: true,
                passkeyTwoFactor: true,
                platformRole: true,
                platformGroupId: true,
                memberships: roleIn(tenantId),
                accounts: { select: { providerId: true } },
                sessions: { select: { createdAt: true, expiresAt: true, userAgent: true, ipAddress: true } },
                // A relation count skips the tenant filter, so the keys of other tenants are left out here.
                _count: { select: { apiKeys: { where: { tenantId } }, passkeys: true, memberships: { where: { tenantId: { not: tenantId } } } } },
            },
        }),
        // The groups of the tenant, which a group belongs to, whatever tenant the caller runs in.
        prisma.group.findMany({
            where: { tenantId },
            select: { id: true, name: true, permissions: true, fullAccess: true, _count: { select: { memberships: { where: { tenantId } } } } },
        }),
        prisma.ssoProvider.findMany({ select: { providerId: true, name: true, adapterId: true } }),
        getPasswordPolicy(),
    ]);

    const model = buildUsersModel({
        users,
        groups,
        providers,
        logins: await loadLogins(users.map((user) => user.id)),
        viewerId,
        viewerPlatformAdmin,
    });
    return { ...model, passwordPolicy, homeTenant: tenantId === HOME_TENANT_ID };
}

/**
 * What needs a look in the tabs of the page: someone without a group, who signs in and sees
 * nothing, and a working API key that runs out within two weeks, like the badge of its row. A null
 * tenant is All tenants, where an account of no tenant is the one that sees nothing and the keys
 * of every tenant count.
 */
export async function getUsersPageAttention(tenantId: string | null, now = Date.now()): Promise<{ users?: TabAttention; apikeys?: TabAttention }> {
    const [grouplessUsers, endingKeys] = await Promise.all([
        // An account of no tenant shows in the home tenant and in All tenants alone, see `peopleOf`.
        tenantId === HOME_TENANT_ID || tenantId === null
            ? prisma.user.findMany({ where: { memberships: { none: {} } }, select: { name: true }, orderBy: { name: "asc" } })
            : [],
        prisma.apiKey.findMany({
            where: { enabled: true, expiresAt: { gt: new Date(now), lte: new Date(now + SOON_MS) } },
            select: { name: true },
            orderBy: { expiresAt: "asc" },
        }),
    ]);
    return {
        users: tenantId === null
            ? attentionOf("warning", grouplessUsers.map((user) => user.name), "works in no tenant and sees nothing", "work in no tenant and see nothing")
            : attentionOf("warning", grouplessUsers.map((user) => user.name), "has no group and sees nothing", "have no group and see nothing"),
        apikeys: attentionOf("warning", endingKeys.map((key) => key.name), "runs out within two weeks", "run out within two weeks"),
    };
}
