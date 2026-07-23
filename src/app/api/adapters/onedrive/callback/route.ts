import { NextRequest, NextResponse } from "next/server";
import { getDecryptedCredentialData, updateCredentialProfile } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const log = logger.child({ route: "adapters/onedrive/callback" });

/**
 * GET /api/adapters/onedrive/callback
 * Handles the OAuth callback from Microsoft.
 * `state` is the OAUTH credential profile id; the refresh token is written back
 * into that profile. Redirects back to the destinations page with status.
 */
export async function GET(req: NextRequest) {
    const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;

    // Verify the user is authenticated before processing the OAuth callback
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        log.warn("Unauthenticated Microsoft OAuth callback attempt");
        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent("Authentication required. Please log in and try again.")}`
        );
    }

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state"); // OAUTH credential profile id
    const error = req.nextUrl.searchParams.get("error");
    const errorDescription = req.nextUrl.searchParams.get("error_description");

    // Handle user denial
    if (error) {
        log.warn("Microsoft OAuth denied by user", { error, errorDescription });
        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent(errorDescription || "Authorization was denied by the user.")}`
        );
    }

    if (!code || !state) {
        log.warn("Missing code or state in Microsoft OAuth callback");
        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent("Missing authorization code or state.")}`
        );
    }

    try {
        // `state` is the OAUTH credential profile id.
        const profile = (await getDecryptedCredentialData(state, "OAUTH")) as OAuthData;

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
            return NextResponse.redirect(
                `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent(`Token exchange failed: ${tokenRes.status}`)}`
            );
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.refresh_token) {
            log.warn("No refresh token received from Microsoft", { credentialId: state });
            return NextResponse.redirect(
                `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent("No refresh token received. Ensure the app has 'offline_access' scope configured.")}`
            );
        }

        // Store the refresh token in the credential profile.
        await updateCredentialProfile(state, {
            data: { clientId: profile.clientId, clientSecret: profile.clientSecret, refreshToken: tokenData.refresh_token } satisfies OAuthData,
        });

        log.info("OneDrive OAuth completed successfully", { credentialId: state });

        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=success&message=${encodeURIComponent("OneDrive authorized successfully!")}`
        );
    } catch (err) {
        log.error("Microsoft OAuth callback failed", {}, err instanceof Error ? err : undefined);
        const message = err instanceof Error ? err.message : "OAuth callback failed";
        return NextResponse.redirect(
            `${origin}/dashboard/connections?tab=destinations&oauth=error&message=${encodeURIComponent(message)}`
        );
    }
}
