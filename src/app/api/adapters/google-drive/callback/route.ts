import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { oauthReturnUrl, type OAuthErrorCode } from "@/lib/core/oauth-result";
import { oauthCallbackCaller, saveRefreshToken } from "@/lib/server/oauth-callback";

const log = logger.child({ route: "adapters/google-drive/callback" });

/**
 * GET /api/adapters/google-drive/callback
 * Handles the OAuth callback from Google.
 * `state` is the one the auth route made, bound to the person, the tenant and the OAUTH credential
 * profile, see `oauthCallbackCaller`. The refresh token is written back into that profile, so every
 * destination referencing it becomes authorized.
 * Redirects back to the destinations page with a fixed code of how it went, see `oauthReturnUrl`.
 */
export async function GET(req: NextRequest) {
    const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
    // The page shows a fixed sentence for the code, never one from the address.
    const fail = (code: OAuthErrorCode) => NextResponse.redirect(oauthReturnUrl(origin, "google-drive", code));

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const error = req.nextUrl.searchParams.get("error");

    // Handle user denial
    if (error) {
        log.warn("Google OAuth denied by user", { error });
        return fail("denied");
    }

    if (!code || !state) {
        log.warn("Missing code or state in Google OAuth callback");
        return fail("missing_code");
    }

    // Who brings the code back, and the login the authorization was started for.
    const caller = await oauthCallbackCaller("google-drive", state);
    if (!caller.ok) {
        log.warn("Refused a Google OAuth callback", { reason: caller.message });
        return fail(caller.code);
    }
    const { ctx, credentialId } = caller;

    try {
        // The clientId and secret of the login the authorization was started for.
        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        const redirectUri = `${origin}/api/adapters/google-drive/callback`;

        const oauth2Client = new google.auth.OAuth2(
            profile.clientId,
            profile.clientSecret,
            redirectUri
        );

        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            log.warn("No refresh token received from Google", { credentialId });
            return fail("no_refresh_token");
        }

        await saveRefreshToken(ctx, credentialId, profile, tokens.refresh_token);

        log.info("Google Drive OAuth completed successfully", { credentialId });

        return NextResponse.redirect(oauthReturnUrl(origin, "google-drive", null));
    } catch (err) {
        log.error("Google OAuth callback failed", { credentialId }, wrapError(err));
        return fail("failed");
    }
}
