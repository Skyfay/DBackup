import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { createOAuthState } from "@/lib/auth/oauth-state";
import { permissionRefusal } from "@/lib/server/permission-refusal";

const log = logger.child({ route: "adapters/onedrive/auth" });

const SCOPES = [
    "Files.ReadWrite.All",
    "offline_access",
    "User.Read",
];

/**
 * POST /api/adapters/onedrive/auth
 * Generates the Microsoft OAuth authorization URL.
 * Body: { credentialId: string } - The OAUTH credential profile to authorize.
 * The resulting refresh token is written back into that profile by the callback, for the same
 * person in the same tenant only.
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

        const profile = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;
        if (!profile.clientId) {
            return NextResponse.json({ error: "Client ID is required" }, { status: 400 });
        }

        // Build callback URL from the request origin
        const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
        const redirectUri = `${origin}/api/adapters/onedrive/callback`;

        const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
        authUrl.searchParams.set("client_id", profile.clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", SCOPES.join(" "));
        authUrl.searchParams.set("response_mode", "query");
        authUrl.searchParams.set("prompt", "consent"); // Force consent to always get refresh_token
        // The callback finds the login by this state, bound to who asked and where, see oauth-state.ts.
        authUrl.searchParams.set("state", createOAuthState({ provider: "onedrive", userId: ctx.userId, tenantId, credentialId }));

        log.info("Generated Microsoft OAuth URL", { credentialId });

        return NextResponse.json({ success: true, data: { authUrl: authUrl.toString() } });
    } catch (error) {
        const refusal = permissionRefusal(error);
        if (refusal) return refusal;
        log.error("Failed to generate Microsoft OAuth URL", {}, error instanceof Error ? error : undefined);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate auth URL" },
            { status: 500 }
        );
    }
}
