import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { createOAuthState } from "@/lib/auth/oauth-state";
import { permissionRefusal } from "@/lib/server/permission-refusal";

const log = logger.child({ route: "adapters/google-drive/auth" });

const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",    // Create/access own files
    "https://www.googleapis.com/auth/drive.readonly", // Browse existing folders
];

/**
 * POST /api/adapters/google-drive/auth
 * Generates the Google OAuth authorization URL.
 * Body: { credentialId: string } - The OAUTH credential profile to authorize.
 *
 * Authorization is tied to the credential profile (not a saved adapter): the
 * resulting refresh token is written back into that profile, so any destination
 * referencing it becomes authorized at once. The callback does it for the same person in the
 * same tenant only.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.WRITE);
        const tenantId = tenantOf(ctx);

        const { credentialId } = await req.json();
        if (!credentialId) {
            return NextResponse.json({ error: "Missing credentialId" }, { status: 400 });
        }

        // clientId + clientSecret come from the OAUTH credential profile.
        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!profile.clientId || !profile.clientSecret) {
            return NextResponse.json({ error: "Client ID and Client Secret are required" }, { status: 400 });
        }

        // Build callback URL from the request origin
        const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/google-drive/callback`;

        const oauth2Client = new google.auth.OAuth2(
            profile.clientId,
            profile.clientSecret,
            redirectUri
        );

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: "offline",
            scope: SCOPES,
            prompt: "consent", // Force consent to always get refresh_token
            // The callback finds the login by this state, bound to who asked and where, see oauth-state.ts.
            state: createOAuthState({ provider: "google-drive", userId: ctx.userId, tenantId, credentialId }),
        });

        log.info("Generated Google OAuth URL", { credentialId });

        return NextResponse.json({ success: true, data: { authUrl } });
    } catch (error) {
        const refusal = permissionRefusal(error);
        if (refusal) return refusal;
        log.error("Failed to generate Google OAuth URL", {}, error instanceof Error ? error : undefined);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate auth URL" },
            { status: 500 }
        );
    }
}
