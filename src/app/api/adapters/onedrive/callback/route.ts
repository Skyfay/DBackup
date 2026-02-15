import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "adapters/onedrive/callback" });

/**
 * GET /api/adapters/onedrive/callback
 * Handles the OAuth callback from Microsoft.
 * Exchanges auth code for tokens and stores the refresh token in the adapter config.
 * Redirects back to the destinations page with success/error status.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state"); // adapter config ID
    const error = req.nextUrl.searchParams.get("error");
    const errorDescription = req.nextUrl.searchParams.get("error_description");
    const origin = req.nextUrl.origin;

    // Handle user denial
    if (error) {
        log.warn("Microsoft OAuth denied by user", { error, errorDescription });
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent(errorDescription || "Authorization was denied by the user.")}`
        );
    }

    if (!code || !state) {
        log.warn("Missing code or state in Microsoft OAuth callback");
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Missing authorization code or state.")}`
        );
    }

    try {
        // Load the adapter config
        const adapterConfig = await prisma.adapterConfig.findUnique({
            where: { id: state },
        });

        if (!adapterConfig || adapterConfig.adapterId !== "onedrive") {
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("Adapter not found.")}`
            );
        }

        const config = decryptConfig(JSON.parse(adapterConfig.config));

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
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: redirectUri,
                scope: "Files.ReadWrite.All offline_access User.Read",
            }),
        });

        if (!tokenRes.ok) {
            const errorBody = await tokenRes.text();
            log.error("Microsoft token exchange failed", { status: tokenRes.status, body: errorBody });
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent(`Token exchange failed: ${tokenRes.status}`)}`
            );
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.refresh_token) {
            log.warn("No refresh token received from Microsoft", { adapterId: state });
            return NextResponse.redirect(
                `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent("No refresh token received. Ensure the app has 'offline_access' scope configured.")}`
            );
        }

        // Update the adapter config with the refresh token
        const updatedConfig = {
            ...config,
            refreshToken: tokenData.refresh_token,
        };

        const encryptedConfig = encryptConfig(updatedConfig);

        await prisma.adapterConfig.update({
            where: { id: state },
            data: {
                config: JSON.stringify(encryptedConfig),
            },
        });

        log.info("OneDrive OAuth completed successfully", { adapterId: state });

        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=success&message=${encodeURIComponent("OneDrive authorized successfully!")}`
        );
    } catch (err) {
        log.error("Microsoft OAuth callback failed", {}, err instanceof Error ? err : undefined);
        const message = err instanceof Error ? err.message : "OAuth callback failed";
        return NextResponse.redirect(
            `${origin}/dashboard/destinations?oauth=error&message=${encodeURIComponent(message)}`
        );
    }
}
