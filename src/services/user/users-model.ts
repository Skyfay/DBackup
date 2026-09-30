import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { attentionOf, type TabAttention } from "@/lib/core/tab-attention";
import { parseUserAgent } from "@/lib/core/user-agent";
import { SOON_MS } from "@/services/auth/api-keys-types";
import type { SecondFactor, SignInMethod, UserRow, UserSignIn, UsersGroup, UsersModel } from "./users-types";

/** The name of the group that passes every check. */
export const SUPER_ADMIN_GROUP = "SuperAdmin";

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
    group: { id: string; name: string } | null;
    accounts: { providerId: string }[];
    sessions: ListedSession[];
    _count: { apiKeys: number; passkeys: number };
}

export interface ListedGroup {
    id: string;
    name: string;
    permissions: string;
    _count: { users: number };
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
    viewerSuperAdmin: boolean;
    now?: number;
}

/** The Users tab: every user with how they sign in, and the numbers above the list. */
export function buildUsersModel({ users, groups, providers, logins, viewerId, viewerSuperAdmin, now = Date.now() }: BuildInput): UsersModel {
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
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            group: user.group ? { id: user.group.id, name: user.group.name } : null,
            superAdmin: user.group?.name === SUPER_ADMIN_GROUP,
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
            members: group._count.users,
            permissions: parsePermissions(group.permissions),
            superAdmin: group.name === SUPER_ADMIN_GROUP,
        }))
        // The SuperAdmin group first, then by name, like the choice in New user.
        .sort((a, b) => Number(b.superAdmin) - Number(a.superAdmin) || a.name.localeCompare(b.name));

    const passwordOnly = rows.filter((row) => row.secondFactor === "none").map((row) => row.name);
    return {
        users: rows,
        groups: groupRows,
        stats: {
            users: rows.length,
            inGroup: rows.filter((row) => row.group).length,
            withoutGroup: rows.filter((row) => !row.group).map((row) => row.name),
            passwordOnly,
            protected: rows.length - passwordOnly.length,
            signedIn: rows.filter((row) => row.lastSignIn && now - Date.parse(row.lastSignIn.at) <= SIGNED_IN_WINDOW_MS).length,
            never: rows.filter((row) => !row.lastSignIn).map((row) => row.name),
            sessions,
            devices: devices.size,
        },
        viewerSuperAdmin,
    };
}

/** Loads the Users tab. The password hashes of the accounts never leave the database. */
export async function getUsersModel(viewerId: string | null, viewerSuperAdmin: boolean): Promise<UsersModel> {
    const [users, groups, providers] = await Promise.all([
        prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                createdAt: true,
                twoFactorEnabled: true,
                passkeyTwoFactor: true,
                group: { select: { id: true, name: true } },
                accounts: { select: { providerId: true } },
                sessions: { select: { createdAt: true, expiresAt: true, userAgent: true, ipAddress: true } },
                _count: { select: { apiKeys: true, passkeys: true } },
            },
        }),
        prisma.group.findMany({ select: { id: true, name: true, permissions: true, _count: { select: { users: true } } } }),
        prisma.ssoProvider.findMany({ select: { providerId: true, name: true, adapterId: true } }),
    ]);

    // One entry per user, the newest, since the rows come newest first.
    const logins = await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.LOGIN, userId: { in: users.map((user) => user.id) } },
        orderBy: { createdAt: "desc" },
        distinct: ["userId"],
        select: { userId: true, createdAt: true, userAgent: true, ipAddress: true },
    });

    return buildUsersModel({
        users,
        groups,
        providers,
        logins: new Map(logins.flatMap((login) => (login.userId ? [[login.userId, login] as const] : []))),
        viewerId,
        viewerSuperAdmin,
    });
}

/**
 * What needs a look in the tabs of the page: someone without a group, who signs in and sees
 * nothing, and a working API key that runs out within two weeks, like the badge of its row.
 */
export async function getUsersPageAttention(now = Date.now()): Promise<{ users?: TabAttention; apikeys?: TabAttention }> {
    const [grouplessUsers, endingKeys] = await Promise.all([
        prisma.user.findMany({ where: { groupId: null }, select: { name: true }, orderBy: { name: "asc" } }),
        prisma.apiKey.findMany({
            where: { enabled: true, expiresAt: { gt: new Date(now), lte: new Date(now + SOON_MS) } },
            select: { name: true },
            orderBy: { expiresAt: "asc" },
        }),
    ]);
    return {
        users: attentionOf("warning", grouplessUsers.map((user) => user.name), "has no group and sees nothing", "have no group and see nothing"),
        apikeys: attentionOf("warning", endingKeys.map((key) => key.name), "runs out within two weeks", "run out within two weeks"),
    };
}
