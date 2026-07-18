import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { Dropbox } from "dropbox";
import { logger } from "@/lib/logging/logger";

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

        const dbx = new Dropbox({
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            refreshToken: profile.refreshToken,
        });

        await dbx.usersGetCurrentAccount();

        return NextResponse.json({ valid: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isExpired =
            message.includes("invalid_access_token") ||
            message.includes("expired_access_token") ||
            message.includes("invalid_grant");
        log.warn("Dropbox token validation failed", { message });
        return NextResponse.json({
            valid: false,
            message: isExpired
                ? "Authorization expired. Please re-authorize with Dropbox."
                : message,
        });
    }
}
