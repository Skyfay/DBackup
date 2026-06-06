import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDecryptedCredentialData, updateCredentialProfile } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const log = logger.child({ route: "adapters/google-drive/callback" });

/**
 * GET /api/adapters/google-drive/callback
 * Handles the OAuth callback from Google.
 * `state` is the OAUTH credential profile id; the refresh token is written back
 * into that profile, so every destination referencing it becomes authorized.
 * Redirects back to the destinations page with success/error status.
 */
export async function GET(req: NextRequest) {
    const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;

    // Verify the user is authenticated before processing the OAuth callback
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        log.warn("Unauthenticated Google OAuth callback attempt");
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Authentication required. Please log in and try again.")}`
        );
    }

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state"); // OAUTH credential profile id
    const error = req.nextUrl.searchParams.get("error");

    // Handle user denial
    if (error) {
        log.warn("Google OAuth denied by user", { error });
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Authorization was denied by the user.")}`
        );
    }

    if (!code || !state) {
        log.warn("Missing code or state in Google OAuth callback");
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Missing authorization code or state.")}`
        );
    }

    try {
        // `state` is the OAUTH credential profile id. Load its clientId + secret.
        const profile = (await getDecryptedCredentialData(state, "OAUTH")) as OAuthData;

        const redirectUri = `${origin}/api/adapters/google-drive/callback`;

        const oauth2Client = new google.auth.OAuth2(
            profile.clientId,
            profile.clientSecret,
            redirectUri
        );

        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            log.warn("No refresh token received from Google", { credentialId: state });
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("No refresh token received. Please revoke app access in your Google Account settings and try again.")}`
            );
        }

        // Store the refresh token in the credential profile.
        await updateCredentialProfile(state, {
            data: { clientId: profile.clientId, clientSecret: profile.clientSecret, refreshToken: tokens.refresh_token } satisfies OAuthData,
        });

        log.info("Google Drive OAuth completed successfully", { credentialId: state });

        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=success&message=${encodeURIComponent("Google Drive authorized successfully!")}`
        );
    } catch (err) {
        log.error("Google OAuth callback failed", {}, err instanceof Error ? err : undefined);
        const message = err instanceof Error ? err.message : "OAuth callback failed";
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent(message)}`
        );
    }
}
