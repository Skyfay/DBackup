import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import prisma from "@/lib/prisma";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "adapters/google-drive/callback" });

/**
 * GET /api/adapters/google-drive/callback
 * Handles the OAuth callback from Google.
 * Exchanges auth code for tokens and stores the refresh token in the adapter config.
 * Redirects back to the destinations page with success/error status.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state"); // adapter config ID
    const error = req.nextUrl.searchParams.get("error");
    const origin = req.nextUrl.origin;

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
        // Load the adapter config
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: state },
        });

        if (!adapterConfig || adapterConfig.adapterId !== "google-drive") {
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Adapter not found.")}`
            );
        }

        const config = decryptConfig(JSON.parse(adapterConfig.config));

        const redirectUri = `${origin}/api/adapters/google-drive/callback`;

        const oauth2Client = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret,
            redirectUri
        );

        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            log.warn("No refresh token received from Google", { adapterId: state });
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("No refresh token received. Please revoke app access in your Google Account settings and try again.")}`
            );
        }

        // Update the adapter config with the refresh token
        const updatedConfig = {
            ...config,
            refreshToken: tokens.refresh_token,
        };

        const encryptedConfig = encryptConfig(updatedConfig);

        await prisma.adapterConfig.update({
            where: { id: state },
            data: {
                config: JSON.stringify(encryptedConfig),
            },
        });

        log.info("Google Drive OAuth completed successfully", { adapterId: state });

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
