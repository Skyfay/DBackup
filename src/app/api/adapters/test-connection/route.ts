import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getPermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "adapters/test-connection" });

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

        const adapter = registry.get(adapterId);

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        if (!adapter.test) {
            return NextResponse.json({ success: false, message: "This adapter does not support connection testing." });
        }

        // Overlay credential profiles onto the (plaintext) config so that the
        // adapter receives a fully merged, ready-to-use config. Required when
        // the user has assigned credential profiles instead of inline secrets.
        const mergedConfig = await overlayCredentialsOnConfig(
            adapterId,
            { ...config },
            primaryCredentialId ?? null,
            sshCredentialId ?? null
        );

        const TEST_TIMEOUT_MS = 10_000;

        const result = await Promise.race([
            adapter.test(mergedConfig),
            new Promise<{ success: false; message: string }>((resolve) =>
                setTimeout(
                    () => resolve({ success: false, message: "Connection test timed out after 10s. Check the host and port settings." }),
                    TEST_TIMEOUT_MS
                )
            ),
        ]);

        // If test successful and we have a configId (editing existing config), update metadata
        if (result.success && result.version && configId) {
            try {
                const existingConfig = await prisma.adapterConfig.findUnique({
                    where: { id: configId },
                    select: { metadata: true }
                });

                const currentMeta = existingConfig?.metadata ? JSON.parse(existingConfig.metadata) : {};
                const newMeta = {
                    ...currentMeta,
                    engineVersion: result.version,
                    lastCheck: new Date().toISOString(),
                    status: 'Online'
                };

                await prisma.adapterConfig.update({
                    where: { id: configId },
                    data: { metadata: JSON.stringify(newMeta) }
                });
            } catch (metaError: unknown) {
                log.error("Failed to update metadata", { configId }, wrapError(metaError));
                // Don't fail the entire request if metadata update fails
            }
        }

        return NextResponse.json(result);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
