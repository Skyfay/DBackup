import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { clientAddress } from "@/lib/core/client-address";
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
    context: {
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
 * Runs after every endpoint of better-auth. A new session is a sign-in, a password sign-in that
 * was turned down is a failed one. A password sign-in of someone with a second factor is not done
 * yet, the second step writes the entry.
 */
export async function recordSignIn(ctx: SignInHookContext): Promise<void> {
    const method = signInMethod(ctx.path);
    if (!method) return;

    const created = ctx.context.newSession;
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
            { method, ...(providerId ? { provider: provider?.name ?? providerId } : {}) },
            undefined,
            { ipAddress: created.session.ipAddress ?? request.ipAddress, userAgent: created.session.userAgent ?? request.userAgent }
        );
        return;
    }

    if (method !== "password" || !refused(ctx.context.returned)) return;
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
        requestOf(ctx)
    );
}

/** Runs before the sign-out endpoint, while the session to end is still there. */
export async function recordSignOut(ctx: SignInHookContext, session: { user: { id: string } } | null): Promise<void> {
    if (ctx.path !== "/sign-out" || !session) return;
    await auditService.log(session.user.id, AUDIT_ACTIONS.LOGOUT, AUDIT_RESOURCES.AUTH, {}, undefined, requestOf(ctx));
}
