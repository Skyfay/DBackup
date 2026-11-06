import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext, tenantRefusal } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { Dropbox } from "dropbox";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { TOKEN_CHECK_FAILED } from "@/lib/server/oauth-callback";
import { credentialName } from "@/services/auth/credential-audit";
import { logProbe, type ProbeTarget } from "@/services/adapters/probe-audit";

const log = logger.child({ route: "adapters/dropbox/validate-token" });

/**
 * POST /api/adapters/dropbox/validate-token
 * Validates whether the stored refresh token for an OAuth credential profile is still accepted by Dropbox.
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

        const dbx = new Dropbox({
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            refreshToken: profile.refreshToken,
        });

        checked = { adapterId: "dropbox", record: { id: credentialId, name: await credentialName(credentialId) } };
        await dbx.usersGetCurrentAccount();
        await logProbe(ctx, "token_check", checked, true);

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        if (checked) await logProbe(ctx, "token_check", checked, false);
        const detail = error instanceof Error ? error.message : String(error);
        const isExpired =
            detail.includes("invalid_access_token") ||
            detail.includes("expired_access_token") ||
            detail.includes("invalid_grant");
        log.warn("Dropbox token validation failed", { expired: isExpired }, wrapError(error));
        return NextResponse.json({
            valid: false,
            message: isExpired ? "Authorization expired. Please re-authorize with Dropbox." : TOKEN_CHECK_FAILED,
        });
    }
}
