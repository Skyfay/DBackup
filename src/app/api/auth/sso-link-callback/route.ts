import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { decryptSealed } from "@/lib/crypto";
import { CONNECT_CALLBACK_PATH, CONNECT_NONCE_COOKIE, connectStartedHere } from "@/lib/auth/sso-connect-nonce";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "sso-link-callback" });

/**
 * Target callbackURL for the "connect an additional SSO provider" flow
 * (src/app/actions/auth/sso-connections.ts, initiateSsoConnect).
 *
 * better-auth's SSO sign-in resolves/creates the user purely from the IdP's
 * returned email, with no awareness of any pre-existing session - so if the
 * IdP happens to authenticate a DIFFERENT email that already has its own
 * DBackup account, the browser session would silently switch to that other
 * user instead of failing. This route compares the resulting session against
 * the token minted right before the redirect and, when the token names another
 * account than the one signed in now, signs that session back out instead of
 * letting it stand. It signs out only in the browser that started the flow,
 * which holds the cookie whose hash the token names, and only while the token
 * is not expired. A link someone else sent, also one with a real token of the
 * sender, arrives without that cookie and signs nobody out, so the address
 * cannot end the session of whoever opens it. The token is opened with
 * `decryptSealed`, so plain JSON in its place counts as no token at all rather
 * than as one DBackup minted.
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get("t");
    const headersList = request.headers;

    let expected: { userId: string; expiresAt: number; nonceHash?: unknown } | null = null;
    if (token) {
        try {
            const parsed = JSON.parse(decryptSealed(decodeURIComponent(token)));
            if (typeof parsed?.userId === "string" && typeof parsed?.expiresAt === "number") {
                expected = parsed;
            }
        } catch (error) {
            log.warn("Failed to decode SSO connect token", {}, wrapError(error));
        }
    }

    const session = await auth.api.getSession({ headers: headersList });

    const nonce = request.cookies.get(CONNECT_NONCE_COOKIE)?.value;
    const live = !!expected && Date.now() <= expected.expiresAt;
    const startedHere = live && connectStartedHere(expected?.nonceHash, nonce);

    const mismatch =
        !expected ||
        !live ||
        !session?.user ||
        session.user.id !== expected.userId;

    if (mismatch) {
        if (expected && startedHere && session?.user && session.user.id !== expected.userId) {
            // The IdP resolved a different identity than the one that started this
            // flow, so the browser does not stay signed in as that other account.
            await auth.api.signOut({ headers: headersList }).catch((error) => {
                log.error("Failed to sign out mismatched SSO connect session", {}, wrapError(error));
            });
        }
        const loginUrl = new URL("/", request.url);
        loginUrl.searchParams.set("error", "sso_link_mismatch");
        return spent(NextResponse.redirect(loginUrl), startedHere);
    }

    // The link itself went into the audit log when better-auth made it, see `recordSsoLink`, also
    // for a link that started on another page than the profile.

    const profileUrl = new URL("/dashboard/profile", request.url);
    profileUrl.searchParams.set("part", "security");
    profileUrl.searchParams.set("connected", "1");
    return spent(NextResponse.redirect(profileUrl), startedHere);
}

/** Clears the cookie of a connect that ended in the browser that started it. Another flow of the browser keeps its own. */
function spent(response: NextResponse, startedHere: boolean): NextResponse {
    if (startedHere) response.cookies.set(CONNECT_NONCE_COOKIE, "", { path: CONNECT_CALLBACK_PATH, maxAge: 0 });
    return response;
}
