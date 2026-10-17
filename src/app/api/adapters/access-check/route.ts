import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { withHost } from "@/lib/transport";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { registerAdapters } from "@/lib/adapters";
import { applyStoredSecrets, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getPermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { assertMayApplySavedLogin, namesSavedLogin } from "@/lib/auth/saved-login-access";
import { PermissionError } from "@/lib/logging/errors";

// Ensure adapters are registered
registerAdapters();

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { adapterId, config, configId, primaryCredentialId, sshCredentialId } = body;

        if (!adapterId || !config) {
            return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
        }

        const requiredPermission = getPermissionForAdapter(adapterId);
        if (!requiredPermission) {
            return NextResponse.json({ success: false, message: "Unsupported adapter" }, { status: 400 });
        }
        checkPermissionWithContext(ctx, requiredPermission);
        if (namesSavedLogin(primaryCredentialId, sshCredentialId)) assertMayApplySavedLogin(ctx, adapterId);

        const adapter = registry.get(adapterId) as DatabaseAdapter | undefined;

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        const listDatabases = adapter.getDatabases;
        if (!listDatabases) {
            return NextResponse.json({ success: false, message: "This adapter does not support listing databases." });
        }

        // Same reason as in the connection test: a saved source submits the
        // secrets held in its own config missing, because they are redacted on
        // the way to the browser.
        const submittedConfig = typeof configId === "string" && configId && canEditStoredConfig(ctx, adapterId)
            ? await applyStoredSecrets(adapterId, configId, { ...config })
            : { ...config };

        const mergedConfig = await overlayCredentialsOnConfig(
            adapterId,
            submittedConfig,
            primaryCredentialId ?? null,
            sshCredentialId ?? null
        );

        const databases = await withHost(adapter, mergedConfig, (host) => listDatabases(mergedConfig, host));

        return NextResponse.json({ success: true, databases });

    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, message: error.message }, { status: 403 });
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
