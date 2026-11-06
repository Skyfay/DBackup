import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getVaultCredentials } from "@/services/vault/vault-credentials";

const log = logger.child({ route: "vault/credentials" });

/**
 * The Credentials tab of the Vault: every profile with the connections that log in with it. Never a
 * secret. The tab lies on the Vault page, which opens with vault:read, so it takes vault:read and
 * credentials:read, the same rule as the saved logins of the search in the header. The pickers of
 * the connection forms read the profiles through `/api/credentials` with credentials:read alone.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.VAULT.READ);
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.READ);
        // The page asks for a tenant first, All tenants would mix the lists of every tenant.
        tenantOf(ctx);
        return NextResponse.json({ success: true, data: await getVaultCredentials() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the credential profiles of the Vault failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The credential profiles could not be loaded" }, { status: 500 });
    }
}
