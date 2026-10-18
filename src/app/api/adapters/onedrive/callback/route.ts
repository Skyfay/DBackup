import { NextRequest, NextResponse } from "next/server";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { oauthCallbackCaller, saveRefreshToken } from "@/lib/server/oauth-callback";

const log = logger.child({ route: "adapters/onedrive/callback" });

/**
 * GET /api/adapters/onedrive/callback
 * Handles the OAuth callback from Microsoft.
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
        log.warn("Microsoft OAuth denied by user", { error, errorDescription });
        return fail(errorDescription || "Authorization was denied by the user.");
    }

    if (!code || !state) {
        log.warn("Missing code or state in Microsoft OAuth callback");
        return fail("Missing authorization code or state.");
    }

    // Who brings the code back, and the login the authorization was started for.
    const caller = await oauthCallbackCaller("onedrive", state);
    if (!caller.ok) {
        log.warn("Refused a Microsoft OAuth callback", { reason: caller.message });
        return fail(caller.message);
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
            return fail(`Token exchange failed: ${tokenRes.status}`);
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.refresh_token) {
            log.warn("No refresh token received from Microsoft", { credentialId });
            return fail("No refresh token received. Ensure the app has 'offline_access' scope configured.");
        }

        await saveRefreshToken(ctx, credentialId, profile, tokenData.refresh_token);

        log.info("OneDrive OAuth completed successfully", { credentialId });

        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=success&message=${encodeURIComponent("OneDrive authorized successfully!")}`
        );
    } catch (err) {
        log.error("Microsoft OAuth callback failed", {}, err instanceof Error ? err : undefined);
        return fail(err instanceof Error ? err.message : "OAuth callback failed");
    }
}
