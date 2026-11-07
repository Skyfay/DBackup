import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { assertMayReadFormConfig } from "@/lib/auth/form-config-access";
import { assertMayApplySavedLogin, namesSavedLogin } from "@/lib/auth/saved-login-access";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError } from "@/lib/logging/errors";
import { answerOf } from "@/lib/adapters/adapter-answer";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { auditedProbe } from "@/services/adapters/probe-audit";
import type { StorageAdapter } from "@/lib/core/interfaces";

const log = logger.child({ route: "adapters/check-snapshot" });

registerAdapters();

/** What the check answers when it fails for a reason of DBackup rather than of the server. */
const SNAPSHOT_CHECK_FAILED = "The snapshot check could not be run. The log of DBackup has the details.";

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
        return unauthorized();
    }

    try {
        const body = await req.json();
        const { adapterId, config, primaryCredentialId, sshCredentialId } = body;

        if (!adapterId || !config) {
            return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
        }

        if (!getManagePermissionForAdapter(adapterId)) {
            return NextResponse.json({ success: false, message: "Unsupported adapter" }, { status: 400 });
        }
        // The config of a form reaches a server of the caller's choosing, so it is for someone who
        // may change connections of its kind, in one tenant, never All tenants.
        assertMayReadFormConfig(ctx, adapterId);
        if (namesSavedLogin(primaryCredentialId, sshCredentialId)) assertMayApplySavedLogin(ctx, adapterId);
        // The logins of the destination of the configuration backup never sign in to a host of the form.
        const locked = await savedLoginRefusal(ctx, primaryCredentialId, sshCredentialId);
        if (locked) return locked;

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
        const supportsSnapshot = adapter.supportsSnapshot.bind(adapter);
        // Written once the check ran, whether the server answered or not, like the test of a connection.
        const result = await auditedProbe(ctx, "snapshot_check", { adapterId, config: mergedConfig }, () => Promise.race([
            // What the server says goes back to the form, a failure of DBackup itself does not.
            answerOf(adapterId, "check snapshots", () => supportsSnapshot(mergedConfig, "")),
            new Promise<{ supported: false; message: string }>((resolve) =>
                setTimeout(
                    () => resolve({ supported: false, message: "The snapshot check timed out after 30s. Check that the server is reachable and its VSS agent service is running." }),
                    CHECK_TIMEOUT_MS
                )
            ),
        ]));

        return NextResponse.json(result);
    } catch (error: unknown) {
        // A refused host, like one in the local network of a tenant that may not reach it, says why.
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        // The words of the server, like a VSS agent that refused the login, are what the form shows.
        if (error instanceof AdapterError) return NextResponse.json({ supported: false, message: error.message }, { status: 200 });
        log.error("Snapshot check failed", {}, wrapError(error));
        return NextResponse.json({ supported: false, message: SNAPSHOT_CHECK_FAILED }, { status: 500 });
    }
}
