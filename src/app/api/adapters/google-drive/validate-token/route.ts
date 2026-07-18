import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "adapters/google-drive/validate-token" });

/**
 * POST /api/adapters/google-drive/validate-token
 * Validates whether the stored refresh token for an OAuth credential profile is still accepted by Google.
 * Body: { credentialId: string }
 * Response: { valid: boolean, message?: string }
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!ctx.isSuperAdmin && !ctx.permissions.includes(PERMISSIONS.CREDENTIALS.READ)) {
        return NextResponse.json(
            { valid: false, message: "Permission denied: credentials:read required" },
            { status: 403 }
        );
    }

    try {
        const { credentialId } = await req.json();
        if (!credentialId) {
            return NextResponse.json({ valid: false, message: "Missing credentialId" }, { status: 400 });
        }

        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!profile.clientId || !profile.clientSecret || !profile.refreshToken) {
            return NextResponse.json({ valid: false, message: "Incomplete credentials" });
        }

        const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/google-drive/callback`;

        const oauth2Client = new google.auth.OAuth2(
            profile.clientId,
            profile.clientSecret,
            redirectUri
        );
        oauth2Client.setCredentials({ refresh_token: profile.refreshToken });

        await oauth2Client.getAccessToken();

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isExpired = message.includes("invalid_grant") || message.includes("Token has been expired");
        log.warn("Google Drive token validation failed", { message });
        return NextResponse.json({
            valid: false,
            message: isExpired ? "Authorization expired. Please re-authorize with Google." : message,
        });
    }
}
