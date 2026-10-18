import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { assertMayApplySavedLogin, namesSavedLogin } from "@/lib/auth/saved-login-access";
import { withoutBinaryPaths } from "@/lib/adapters/config-resolver";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { testConnection } from "@/services/adapters/connection-test";

// Ensure adapters are registered
registerAdapters();

/**
 * POST /api/adapters/test-connection
 *
 * Tries the config of the connection form, for someone who may change connections of the kind.
 * Who may change the saved connection itself gets its secrets filled in and keeps the version the
 * test finds with it. All tenants belongs to no tenant and tries none.
 */
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

        // A config of a form runs as it came, with the options and programs it names, so only
        // someone who may change connections of the kind tries one.
        const requiredPermission = getManagePermissionForAdapter(adapterId);
        if (!requiredPermission) {
            return NextResponse.json({ success: false, message: "Unsupported adapter" }, { status: 400 });
        }
        checkPermissionWithContext(ctx, requiredPermission);
        tenantOf(ctx);
        if (namesSavedLogin(primaryCredentialId, sshCredentialId)) assertMayApplySavedLogin(ctx, adapterId);

        // Only someone who may change the saved connection gets its secrets filled in, and has the
        // version the test finds kept with it.
        const manages = canEditStoredConfig(ctx, adapterId);
        const savedId = typeof configId === "string" && configId && manages ? configId : undefined;

        const outcome = await testConnection({
            adapterId,
            config: manages ? config : withoutBinaryPaths(config),
            storedConfigId: savedId,
            configId: savedId,
            primaryCredentialId,
            sshCredentialId,
        });
        if (!outcome.ok) {
            return outcome.reason === "adapter-missing"
                ? NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 })
                : NextResponse.json({ success: false, message: "This adapter does not support connection testing." });
        }

        return NextResponse.json(outcome.result);

    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
