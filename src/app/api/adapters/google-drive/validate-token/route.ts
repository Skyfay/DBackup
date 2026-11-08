import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { google } from "googleapis";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext, tenantRefusal } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { TOKEN_CHECK_FAILED } from "@/lib/server/oauth-callback";
import { credentialName } from "@/services/auth/credential-audit";
import { logProbe, type ProbeTarget } from "@/services/adapters/probe-audit";

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
        return unauthorized();
    }

    if (!hasPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.READ)) {
        return NextResponse.json(
            { valid: false, message: "Permission denied: credentials:read required" },
            { status: 403 }
        );
    }
    // A saved login belongs to one tenant, and All tenants would check the login of any of them.
    const outsideTenant = tenantRefusal(ctx);
    if (outsideTenant) return NextResponse.json({ valid: false, message: outsideTenant }, { status: 403 });

    // Set once the provider is asked, so a failure before writes no entry.
    let checked: ProbeTarget | null = null;
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

        checked = { adapterId: "google-drive", record: { id: credentialId, name: await credentialName(credentialId) } };
        await oauth2Client.getAccessToken();
        await logProbe(ctx, "token_check", checked, true);

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        if (checked) await logProbe(ctx, "token_check", checked, false);
        const detail = error instanceof Error ? error.message : String(error);
        const isExpired = detail.includes("invalid_grant") || detail.includes("Token has been expired");
        log.warn("Google Drive token validation failed", { expired: isExpired }, wrapError(error));
        return NextResponse.json({
            valid: false,
            message: isExpired ? "Authorization expired. Please re-authorize with Google." : TOKEN_CHECK_FAILED,
        });
    }
}
