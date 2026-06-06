import { NextRequest, NextResponse } from "next/server";
import { DropboxAuth } from "dropbox";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "adapters/dropbox/auth" });

/**
 * POST /api/adapters/dropbox/auth
 * Generates the Dropbox OAuth authorization URL.
 * Body: { credentialId: string } - The OAUTH credential profile to authorize.
 * The resulting refresh token is written back into that profile.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.WRITE);

        const { credentialId } = await req.json();
        if (!credentialId) {
            return NextResponse.json({ error: "Missing credentialId" }, { status: 400 });
        }

        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!profile.clientId || !profile.clientSecret) {
            return NextResponse.json({ error: "App Key and App Secret are required" }, { status: 400 });
        }

        // Build callback URL from the request origin
        const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/dropbox/callback`;

        const dbxAuth = new DropboxAuth({
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            fetch: fetch,
        });

        const authUrl = await dbxAuth.getAuthenticationUrl(
            redirectUri,
            credentialId, // state parameter for callback
            "code",
            "offline", // Request offline access to get refresh_token
            undefined, // scopes - use app-configured scopes
            "none",
            false
        );

        log.info("Generated Dropbox OAuth URL", { credentialId });

        return NextResponse.json({ success: true, data: { authUrl: String(authUrl) } });
    } catch (error) {
        log.error("Failed to generate Dropbox OAuth URL", {}, error instanceof Error ? error : undefined);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate auth URL" },
            { status: 500 }
        );
    }
}
