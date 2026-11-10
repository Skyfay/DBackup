import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { clientAddress } from "@/lib/core/client-address";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";

/**
 * Sign-ins, failed sign-ins and sign-outs in the audit log, written by the server around the
 * endpoints of better-auth. The browser used to write the sign-in itself after a password or a
 * passkey, so a sign-in through single sign-on never reached the log.
 */

export type SignInMethod = "password" | "passkey" | "two-factor" | "sso";

/** The endpoint of better-auth that signs someone in, with the way they did, or null for any other. */
export function signInMethod(path: string | undefined): SignInMethod | null {
    if (!path) return null;
    if (path === "/sign-in/email") return "password";
    if (path === "/passkey/verify-authentication") return "passkey";
    if (path.startsWith("/two-factor/verify-")) return "two-factor";
    if (path.startsWith("/sso/callback/") || path.startsWith("/sso/saml2/callback/")) return "sso";
    return null;
}

/** The parts of the context of a better-auth hook these entries read. */
export interface SignInHookContext {
    path?: string;
    body?: unknown;
    params?: Record<string, string | undefined>;
    headers?: Headers;
    request?: Request;
    /** Reads a cookie better-auth signed, like the one of a pending second factor. */
    getSignedCookie?: (name: string, secret: string) => Promise<string | null | false | undefined>;
    context: {
        secret?: string;
        createAuthCookie?: (name: string) => { name: string };
        /** Where better-auth keeps the account a pending second factor belongs to. */
        internalAdapter?: { findVerificationValue: (identifier: string) => Promise<{ value: string; expiresAt?: Date | string } | null | undefined> };
        /** The session the request came with. A code of the second factor with one finishes its setup, it signs nobody in. */
        session?: { session: unknown } | null;
        newSession?: {
            user: { id: string; twoFactorEnabled?: boolean | null };
            session: { ipAddress?: string | null; userAgent?: string | null };
        } | null;
        returned?: unknown;
    };
}

function requestOf(ctx: SignInHookContext) {
    const list = ctx.headers ?? ctx.request?.headers;
    return { ipAddress: list ? clientAddress(list) : null, userAgent: list?.get("user-agent") ?? null };
}

/** A turned down request, as better-auth answers it: an error with a status below 500. */
function refused(returned: unknown): boolean {
    if (!returned || typeof returned !== "object") return false;
    const status = (returned as { statusCode?: unknown; status?: unknown }).statusCode ?? (returned as { status?: unknown }).status;
    return typeof status === "number" ? status >= 400 && status < 500 : typeof status === "string" && status !== "OK";
}

/**
 * Runs after every endpoint of better-auth. A new session is a sign-in, a password, a code of the
 * second factor or a passkey that was turned down is a failed one. A password sign-in of someone with a second factor is not done
 * yet, the second step writes the entry.
 */
export async function recordSignIn(ctx: SignInHookContext): Promise<void> {
    const method = signInMethod(ctx.path);
    if (!method) return;

    const created = ctx.context.newSession;
    // Turning the second factor on hands out a new session too, see security-audit.ts for its entry.
    if (method === "two-factor" && ctx.context.session?.session) return;
    if (created) {
        if (method === "password" && created.user.twoFactorEnabled) return;
        const providerId = method === "sso" ? ctx.params?.providerId : undefined;
        const provider = providerId
            ? await prisma.ssoProvider.findUnique({ where: { providerId }, select: { name: true } }).catch(() => null)
            : null;
        const request = requestOf(ctx);
        await auditService.log(
            created.user.id,
            AUDIT_ACTIONS.LOGIN,
            AUDIT_RESOURCES.AUTH,
            { method, ...(providerId ? { provider: provider?.name ?? providerId, providerId } : {}) },
            undefined,
            { ipAddress: created.session.ipAddress ?? request.ipAddress, userAgent: created.session.userAgent ?? request.userAgent, tenantId: HOME_TENANT_ID }
        );
        return;
    }

    if (!refused(ctx.context.returned)) return;
    if (method === "two-factor") return recordFailedSecondStep(ctx);
    if (method === "passkey") {
        // The passkey that was turned down names no account better-auth vouches for, so the entry names none.
        await auditService.log(null, AUDIT_ACTIONS.LOGIN_FAILED, AUDIT_RESOURCES.AUTH, { method, reason: "passkey_refused" }, undefined, { ...requestOf(ctx), tenantId: HOME_TENANT_ID });
        return;
    }
    if (method !== "password") return;
    const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    const account = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }).catch(() => null) : null;
    // Nobody is signed in yet, so the entry has no user. It points at the account that was tried.
    await auditService.log(
        null,
        AUDIT_ACTIONS.LOGIN_FAILED,
        AUDIT_RESOURCES.AUTH,
        { method, ...(email ? { email } : {}), reason: account ? "wrong_password" : "unknown_email" },
        account?.id,
        { ...requestOf(ctx), tenantId: HOME_TENANT_ID }
    );
}

/** The cookie better-auth keeps the pending second factor in, see its two-factor plugin. */
const TWO_FACTOR_COOKIE = "two_factor";

/**
 * The account a pending second factor belongs to, from the signed cookie of the first step and the
 * value better-auth stored for it, or null where better-auth does not expose it or the value ran
 * out. better-auth hands back a value past its end once more before it cleans up.
 */
export async function pendingTwoFactorUser(ctx: SignInHookContext): Promise<string | null> {
    const { secret, createAuthCookie, internalAdapter } = ctx.context;
    if (!ctx.getSignedCookie || !secret || !createAuthCookie || !internalAdapter) return null;
    try {
        const identifier = await ctx.getSignedCookie(createAuthCookie(TWO_FACTOR_COOKIE).name, secret);
        if (!identifier) return null;
        const pending = await internalAdapter.findVerificationValue(identifier);
        if (!pending || (pending.expiresAt !== undefined && new Date(pending.expiresAt).getTime() <= Date.now())) return null;
        return pending.value;
    } catch {
        return null;
    }
}

/**
 * A code of the second factor that was turned down. A code sent with a session finishes the setup
 * of the second factor and signs nobody in, see security-audit.ts. The entry points at the account
 * of the first step, with nobody as its author, like a turned down password.
 */
async function recordFailedSecondStep(ctx: SignInHookContext): Promise<void> {
    if (ctx.context.session?.session) return;
    const userId = await pendingTwoFactorUser(ctx);
    const account = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }).catch(() => null) : null;
    await auditService.log(
        null,
        AUDIT_ACTIONS.LOGIN_FAILED,
        AUDIT_RESOURCES.AUTH,
        { method: "two-factor", ...(account ? { email: account.email } : {}), reason: "wrong_code" },
        account?.id,
        { ...requestOf(ctx), tenantId: HOME_TENANT_ID }
    );
}

/** Runs before the sign-out endpoint, while the session to end is still there. */
export async function recordSignOut(ctx: SignInHookContext, session: { user: { id: string } } | null): Promise<void> {
    if (ctx.path !== "/sign-out" || !session) return;
    // An account signs in and out of the instance, not of the tenant it looks at, so both go to the home tenant.
    await auditService.log(session.user.id, AUDIT_ACTIONS.LOGOUT, AUDIT_RESOURCES.AUTH, {}, undefined, { ...requestOf(ctx), tenantId: HOME_TENANT_ID });
}
