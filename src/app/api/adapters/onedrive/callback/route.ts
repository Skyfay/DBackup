import { NextRequest, NextResponse } from "next/server";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { oauthReturnUrl, type OAuthErrorCode } from "@/lib/core/oauth-result";
import { oauthCallbackCaller, saveRefreshToken } from "@/lib/server/oauth-callback";

const log = logger.child({ route: "adapters/onedrive/callback" });

/**
 * GET /api/adapters/onedrive/callback
 * Handles the OAuth callback from Microsoft.
 * `state` is the one the auth route made, bound to the person, the tenant and the OAUTH credential
 * profile, see `oauthCallbackCaller`. The refresh token is written back into that profile.
 * Redirects back to the destinations page with a fixed code of how it went, see `oauthReturnUrl`.
 */
export async function GET(req: NextRequest) {
    const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
    // The page shows a fixed sentence for the code, never one from the address.
    const fail = (code: OAuthErrorCode) => NextResponse.redirect(oauthReturnUrl(origin, "onedrive", code));

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const error = req.nextUrl.searchParams.get("error");
    const errorDescription = req.nextUrl.searchParams.get("error_description");

    // Handle user denial
    if (error) {
        log.warn("Microsoft OAuth denied by user", { error, errorDescription });
        // The description comes in the query, which anyone can write into a link, so it goes to the log only.
        return fail("denied");
    }

    if (!code || !state) {
        log.warn("Missing code or state in Microsoft OAuth callback");
        return fail("missing_code");
    }

    // Who brings the code back, and the login the authorization was started for.
    const caller = await oauthCallbackCaller("onedrive", state);
    if (!caller.ok) {
        log.warn("Refused a Microsoft OAuth callback", { reason: caller.message });
        return fail(caller.code);
    }
    const { ctx, credentialId } = caller;

    try {
        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        const redirectUri = `${origin}/api/adapters/onedrive/callback`;

        // Exchange authorization code for tokens using Microsoft token endpoint
        const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code,
                grant_type: "authorization_code",
                client_id: profile.clientId,
                client_secret: profile.clientSecret,
                redirect_uri: redirectUri,
                scope: "Files.ReadWrite.All offline_access User.Read",
            }),
        });

        if (!tokenRes.ok) {
            const errorBody = await tokenRes.text();
            log.error("Microsoft token exchange failed", { status: tokenRes.status, body: errorBody });
            return fail("token_exchange");
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.refresh_token) {
            log.warn("No refresh token received from Microsoft", { credentialId });
            return fail("no_refresh_token");
        }

        await saveRefreshToken(ctx, credentialId, profile, tokenData.refresh_token);

        log.info("OneDrive OAuth completed successfully", { credentialId });

        return NextResponse.redirect(oauthReturnUrl(origin, "onedrive", null));
    } catch (err) {
        log.error("Microsoft OAuth callback failed", { credentialId }, wrapError(err));
        return fail("failed");
    }
}
