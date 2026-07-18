import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "adapters/onedrive/validate-token" });
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * POST /api/adapters/onedrive/validate-token
 * Validates whether the stored refresh token for an OAuth credential profile is still accepted by Microsoft.
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

        const body = new URLSearchParams({
            client_id: profile.clientId,
            client_secret: profile.clientSecret,
            refresh_token: profile.refreshToken,
            grant_type: "refresh_token",
            scope: "Files.ReadWrite.All offline_access",
        });

        const res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const isExpired = data.error === "invalid_grant" || data.error === "interaction_required";
            log.warn("OneDrive token validation failed", { error: data.error });
            return NextResponse.json({
                valid: false,
                message: isExpired
                    ? "Authorization expired. Please re-authorize with Microsoft."
                    : `Token refresh failed: ${data.error_description ?? res.statusText}`,
            });
        }

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn("OneDrive token validation error", { message });
        return NextResponse.json({ valid: false, message });
    }
}
