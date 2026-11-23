import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES, SECURITY_CHANGES } from "@/lib/core/audit-types";
import { diffFields } from "@/lib/core/audit-diff";
import { clientAddress } from "@/lib/core/client-address";
import { ALL_TENANTS } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";

/**
 * Changes of the own second factor, passkeys and sessions in the audit log. The browser makes them through
 * the endpoints of better-auth, past every action of DBackup, so the hooks around those endpoints
 * write the entry once the endpoint succeeded, into the log `accountLogOrigin` picks, like the
 * actions of the own profile do. The sign-in with a second factor or a passkey is written by
 * `sign-in-audit.ts`.
 */

/** The parts of the context of a better-auth hook these entries read. */
export interface SecurityHookContext {
    path?: string;
    body?: unknown;
    headers?: Headers;
    request?: Request;
    context: {
        /** The session the request came with, which the endpoint or the guard of the profile read. */
        session?: { user: { id: string; name?: string | null }; session: { activeTenantId?: string | null; token?: string } | null } | null;
        returned?: unknown;
    };
}

/** What the `before` hook read for the `after` hook, which the endpoint changes or removes. */
interface Before {
    /** The app waited for its first code, so a right code turns the second factor on. */
    appPending?: boolean;
    /** The name of the passkey before it is renamed or deleted. */
    passkeyName?: string | null;
    /** A passkey is the second factor, which turning off the app leaves on, see `passkey-factor-guard.ts`. */
    passkeyFactor?: boolean;
    /** How many sessions of the account the endpoint ends, which better-auth answers the same for none. */
    sessionsEnding?: number;
}

/** The endpoints the browser ends its own sessions with, from the sessions of the profile. */
const SESSION_ENDPOINTS: ReadonlySet<string> = new Set(["/revoke-session", "/revoke-other-sessions", "/revoke-sessions"]);

/** By the context of one request, which better-auth hands to both hooks and the endpoint. */
const before = new WeakMap<object, Before>();

const field = (body: unknown, key: string): string | null => {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
    return typeof value === "string" && value.trim() ? value.trim() : null;
};

/** Whether the endpoint answered without an error. */
function succeeded(returned: unknown): boolean {
    if (returned === undefined || returned instanceof Error) return false;
    const status = returned && typeof returned === "object" ? (returned as { statusCode?: unknown }).statusCode : undefined;
    return !(typeof status === "number" && status >= 400);
}

/** The signed-in account of the request, null for a call without a session like a sign-in. */
function signedIn(ctx: SecurityHookContext) {
    const session = ctx.context.session;
    return session?.session && session.user?.id ? session : null;
}

/**
 * Runs before the endpoints of the second factor, the passkeys and the own sessions, after the guard
 * of the profile passed, and reads what the endpoint changes, so the entry can say what it was. The
 * guard read the session of an endpoint of the profile already, `sessionOf` reads it for the others.
 */
export async function noteSecurityChange(ctx: SecurityHookContext, sessionOf?: () => Promise<unknown>): Promise<void> {
    const ending = !!ctx.path && SESSION_ENDPOINTS.has(ctx.path);
    if (ending && !signedIn(ctx) && sessionOf) await sessionOf();
    const session = signedIn(ctx);
    if (!session) return;
    const userId = session.user.id;
    if (ending && ctx.path) {
        before.set(ctx.context, { sessionsEnding: await sessionsEnding(ctx.path, userId, ctx.body, session.session?.token) });
        return;
    }
    if (ctx.path === "/two-factor/verify-totp") {
        const app = await prisma.twoFactor.findUnique({ where: { userId }, select: { verified: true } });
        before.set(ctx.context, { appPending: !!app && app.verified === false });
    } else if (ctx.path === "/two-factor/disable") {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { passkeyTwoFactor: true } });
        before.set(ctx.context, { passkeyFactor: !!user?.passkeyTwoFactor });
    } else if (ctx.path === "/passkey/update-passkey" || ctx.path === "/passkey/delete-passkey") {
        const id = field(ctx.body, "id");
        const passkey = id ? await prisma.passkey.findFirst({ where: { id, userId }, select: { name: true } }) : null;
        before.set(ctx.context, { passkeyName: passkey?.name ?? null });
    }
}

/**
 * The sessions of the account that an endpoint of the own sessions ends, like better-auth picks
 * them: the one of the token while it is the account's, every other one that has not run out, or
 * every one.
 */
async function sessionsEnding(path: string, userId: string, body: unknown, current: string | undefined): Promise<number> {
    if (path === "/revoke-session") {
        const token = field(body, "token");
        return token ? prisma.session.count({ where: { token, userId } }) : 0;
    }
    if (path === "/revoke-other-sessions") {
        return prisma.session.count({ where: { userId, expiresAt: { gt: new Date() }, ...(current ? { token: { not: current } } : {}) } });
    }
    return prisma.session.count({ where: { userId } });
}

/** The entry an endpoint that succeeded writes, null for one that changes nothing worth one. */
function entryOf(ctx: SecurityHookContext, noted: Before | undefined): Record<string, unknown> | null {
    switch (ctx.path) {
        case "/two-factor/enable":
            return { change: SECURITY_CHANGES.appSetUp };
        case "/two-factor/verify-totp":
            // With a session the code finishes the setup of the app. A code of an app that is set up already changes nothing.
            return noted?.appPending ? { change: SECURITY_CHANGES.on } : null;
        case "/two-factor/disable":
            // The passkey stays the second factor then, only the app is gone.
            return { change: noted?.passkeyFactor ? SECURITY_CHANGES.appRemoved : SECURITY_CHANGES.off };
        case "/two-factor/generate-backup-codes":
            return { change: SECURITY_CHANGES.backupCodes };
        case "/passkey/verify-registration": {
            const returned = ctx.context.returned as { name?: unknown } | null;
            const name = typeof returned?.name === "string" && returned.name.trim() ? returned.name.trim() : field(ctx.body, "name");
            return { change: SECURITY_CHANGES.passkeyAdded, ...(name ? { passkey: name } : {}) };
        }
        case "/passkey/update-passkey": {
            const name = field(ctx.body, "name");
            const changes = diffFields({ name: noted?.passkeyName ?? null }, { name }, { name: { label: "Passkey name" } });
            return { change: SECURITY_CHANGES.passkeyRenamed, ...(name ? { passkey: name } : {}), changes };
        }
        case "/passkey/delete-passkey":
            return { change: SECURITY_CHANGES.passkeyDeleted, ...(noted?.passkeyName ? { passkey: noted.passkeyName } : {}) };
        // A token of another account or of no session ends nothing, which better-auth answers like a success.
        case "/revoke-session":
            return noted?.sessionsEnding ? { change: SECURITY_CHANGES.sessionEnded } : null;
        case "/revoke-other-sessions":
            return noted?.sessionsEnding ? { change: SECURITY_CHANGES.otherSessionsEnded, sessions: noted.sessionsEnding } : null;
        case "/revoke-sessions":
            return { change: SECURITY_CHANGES.allSessionsEnded, ...(noted?.sessionsEnding ? { sessions: noted.sessionsEnding } : {}) };
        default:
            return null;
    }
}

/**
 * Runs after every endpoint of better-auth. A change of the own second factor or passkeys that
 * succeeded is written as `UPDATE USER` on the account, with what changed in `change`.
 */
export async function recordSecurityChange(ctx: SecurityHookContext): Promise<void> {
    const noted = before.get(ctx.context);
    before.delete(ctx.context);
    const session = signedIn(ctx);
    if (!session || !succeeded(ctx.context.returned)) return;
    const details = entryOf(ctx, noted);
    if (!details) return;

    const userId = session.user.id;
    const active = session.session?.activeTenantId ?? null;
    const origin = await accountLogOrigin({ tenantId: active === ALL_TENANTS ? null : active, allTenants: active === ALL_TENANTS }, userId);
    const list = ctx.headers ?? ctx.request?.headers;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { name: user?.name ?? session.user.name ?? null, ...details }, userId, {
        ...origin,
        ipAddress: list ? clientAddress(list) : null,
        userAgent: list?.get("user-agent") ?? null,
    });
}
