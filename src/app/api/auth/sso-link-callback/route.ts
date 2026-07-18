import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
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
 * the token minted right before the redirect and, on any mismatch, signs the
 * unexpected session back out instead of letting it stand.
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get("t");
    const headersList = request.headers;

    let expected: { userId: string; expiresAt: number } | null = null;
    if (token) {
        try {
            const parsed = JSON.parse(decrypt(decodeURIComponent(token)));
            if (typeof parsed?.userId === "string" && typeof parsed?.expiresAt === "number") {
                expected = parsed;
            }
        } catch (error) {
            log.warn("Failed to decode SSO connect token", {}, wrapError(error));
        }
    }

    const session = await auth.api.getSession({ headers: headersList });

    const mismatch =
        !expected ||
        Date.now() > expected.expiresAt ||
        !session?.user ||
        session.user.id !== expected.userId;

    if (mismatch) {
        if (session?.user) {
            // The IdP resolved a different identity than the one that started this
            // flow - do not leave the browser signed in as that other account.
            await auth.api.signOut({ headers: headersList }).catch((error) => {
                log.error("Failed to sign out mismatched SSO connect session", {}, wrapError(error));
            });
        }
        const loginUrl = new URL("/", request.url);
        loginUrl.searchParams.set("error", "sso_link_mismatch");
        return NextResponse.redirect(loginUrl);
    }

    await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.AUTH,
        { change: "SSO account connected" },
        session.user.id
    );

    const profileUrl = new URL("/dashboard/profile", request.url);
    profileUrl.searchParams.set("tab", "sso");
    profileUrl.searchParams.set("connected", "1");
    return NextResponse.redirect(profileUrl);
}
