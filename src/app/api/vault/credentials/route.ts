import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getVaultCredentials } from "@/services/vault/vault-credentials";

const log = logger.child({ route: "vault/credentials" });

/** The Credentials tab of the Vault: every profile with the connections that log in with it. Never a secret. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.READ);
        return NextResponse.json({ success: true, data: await getVaultCredentials() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the credential profiles of the Vault failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The credential profiles could not be loaded" }, { status: 500 });
    }
}
