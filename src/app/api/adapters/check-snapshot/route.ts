import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getPermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import type { StorageAdapter } from "@/lib/core/interfaces";

const log = logger.child({ route: "adapters/check-snapshot" });

registerAdapters();

/**
 * Asks a storage server whether it can produce point-in-time snapshots of a path.
 *
 * The form gates its snapshot toggle on this, and the adapter save path runs the same
 * check again - a UI-only gate would be trivial to bypass through the API, and a backup
 * configured to rely on snapshots must never quietly run without one.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { adapterId, config, primaryCredentialId, sshCredentialId } = body;

        if (!adapterId || !config) {
            return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
        }

        const requiredPermission = getPermissionForAdapter(adapterId);
        if (!requiredPermission) {
            return NextResponse.json({ success: false, message: "Unsupported adapter" }, { status: 400 });
        }
        checkPermissionWithContext(ctx, requiredPermission);

        const adapter = registry.get(adapterId) as StorageAdapter | undefined;
        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }
        if (!adapter.supportsSnapshot) {
            return NextResponse.json({ supported: false, message: "This adapter cannot create snapshots." });
        }

        const mergedConfig = await overlayCredentialsOnConfig(
            adapterId,
            { ...config },
            primaryCredentialId ?? null,
            sshCredentialId ?? null
        );

        // Probing talks to a remote RPC service that may not answer at all.
        const CHECK_TIMEOUT_MS = 30_000;
        const result = await Promise.race([
            adapter.supportsSnapshot(mergedConfig, ""),
            new Promise<{ supported: false; message: string }>((resolve) =>
                setTimeout(
                    () => resolve({ supported: false, message: "The snapshot check timed out after 30s. Check that the server is reachable and its VSS agent service is running." }),
                    CHECK_TIMEOUT_MS
                )
            ),
        ]);

        return NextResponse.json(result);
    } catch (error: unknown) {
        log.error("Snapshot check failed", {}, wrapError(error));
        const message = error instanceof Error ? error.message : "Snapshot check failed";
        return NextResponse.json({ supported: false, message }, { status: 200 });
    }
}
