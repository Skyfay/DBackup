import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
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

        const body = new URLSearchParams({
            client_id: profile.clientId,
            client_secret: profile.clientSecret,
            refresh_token: profile.refreshToken,
            grant_type: "refresh_token",
            scope: "Files.ReadWrite.All offline_access",
        });

        checked = { adapterId: "onedrive", record: { id: credentialId, name: await credentialName(credentialId) } };
        const res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });

        // The answer of the provider is written once it came, whichever it was.
        await logProbe(ctx, "token_check", checked, res.ok);
        checked = null;
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const isExpired = data.error === "invalid_grant" || data.error === "interaction_required";
            log.warn("OneDrive token validation failed", { status: res.status, error: data.error, description: data.error_description });
            return NextResponse.json({
                valid: false,
                message: isExpired ? "Authorization expired. Please re-authorize with Microsoft." : TOKEN_CHECK_FAILED,
            });
        }

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        if (checked) await logProbe(ctx, "token_check", checked, false);
        log.warn("OneDrive token validation error", {}, wrapError(error));
        return NextResponse.json({ valid: false, message: TOKEN_CHECK_FAILED });
    }
}
