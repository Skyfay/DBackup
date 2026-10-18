import { NextRequest, NextResponse } from "next/server";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { oauthCallbackCaller, saveRefreshToken } from "@/lib/server/oauth-callback";

const log = logger.child({ route: "adapters/dropbox/callback" });

/**
 * GET /api/adapters/dropbox/callback
 * Handles the OAuth callback from Dropbox.
 * `state` is the one the auth route made, bound to the person, the tenant and the OAUTH credential
 * profile, see `oauthCallbackCaller`. The refresh token is written back into that profile.
 * Redirects back to the destinations page with status.
 */
export async function GET(req: NextRequest) {
    const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
    const fail = (message: string) =>
        NextResponse.redirect(`${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent(message)}`);

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const error = req.nextUrl.searchParams.get("error");
    const errorDescription = req.nextUrl.searchParams.get("error_description");

    // Handle user denial
    if (error) {
        log.warn("Dropbox OAuth denied by user", { error, errorDescription });
        return fail(errorDescription || "Authorization was denied by the user.");
    }

    if (!code || !state) {
        log.warn("Missing code or state in Dropbox OAuth callback");
        return fail("Missing authorization code or state.");
    }

    // Who brings the code back, and the login the authorization was started for.
    const caller = await oauthCallbackCaller("dropbox", state);
    if (!caller.ok) {
        log.warn("Refused a Dropbox OAuth callback", { reason: caller.message });
        return fail(caller.message);
    }
    const { ctx, credentialId } = caller;

    try {
        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        const redirectUri = `${origin}/api/adapters/dropbox/callback`;

        // Exchange authorization code for tokens using direct API call
        // (DropboxAuth SDK has issues with token exchange in server environments)
        const tokenRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
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
            }),
        });

        if (!tokenRes.ok) {
            const errorBody = await tokenRes.text();
            log.error("Dropbox token exchange failed", { status: tokenRes.status, body: errorBody });
            return fail(`Token exchange failed: ${tokenRes.status}`);
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.refresh_token) {
            log.warn("No refresh token received from Dropbox", { credentialId });
            return fail("No refresh token received. Ensure the app has 'offline' access configured.");
        }

        await saveRefreshToken(ctx, credentialId, profile, tokenData.refresh_token);

        log.info("Dropbox OAuth completed successfully", { credentialId });

        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=success&message=${encodeURIComponent("Dropbox authorized successfully!")}`
        );
    } catch (err) {
        log.error("Dropbox OAuth callback failed", {}, err instanceof Error ? err : undefined);
        return fail(err instanceof Error ? err.message : "OAuth callback failed");
    }
}
