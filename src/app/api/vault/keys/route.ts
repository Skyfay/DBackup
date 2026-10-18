import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getVaultKeys } from "@/services/vault/vault-keys";

const log = logger.child({ route: "vault/keys" });

/** The Encryption tab of the Vault: every key with what encrypts with it, what it protects and its recovery kit. Never a key. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.VAULT.READ);
        // The page asks for a tenant first, All tenants would mix the lists of every tenant.
        tenantOf(ctx);
        return NextResponse.json({ success: true, data: await getVaultKeys() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the keys of the Vault failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The keys could not be loaded" }, { status: 500 });
    }
}
