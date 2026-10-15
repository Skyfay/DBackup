import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getPermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { testConnection } from "@/services/adapters/connection-test";

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

        // Only someone who may change the saved connection gets its secrets filled in.
        const storedConfigId = typeof configId === "string" && configId && canEditStoredConfig(ctx, adapterId)
            ? configId
            : undefined;

        const outcome = await testConnection({ adapterId, config, storedConfigId, configId, primaryCredentialId, sshCredentialId });
        if (!outcome.ok) {
            return outcome.reason === "adapter-missing"
                ? NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 })
                : NextResponse.json({ success: false, message: "This adapter does not support connection testing." });
        }

        return NextResponse.json(outcome.result);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
