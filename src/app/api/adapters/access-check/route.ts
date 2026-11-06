import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { registry } from "@/lib/core/registry";
import { withHost } from "@/lib/transport";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { registerAdapters } from "@/lib/adapters";
import { applyStoredSecrets, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { assertMayApplySavedLogin, namesSavedLogin } from "@/lib/auth/saved-login-access";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { answerOf } from "@/lib/adapters/adapter-answer";
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError } from "@/lib/logging/errors";
import { savedLoginRefusal, storedSecretsRefusal } from "@/lib/server/config-backup-target-guard";
import { auditedDatabasesRead } from "@/services/databases/databases-read-audit";

// Ensure adapters are registered
registerAdapters();

const log = logger.child({ route: "adapters/access-check" });

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
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
        // A config of a form runs in one tenant, All tenants belongs to none.
        tenantOf(ctx);
        if (namesSavedLogin(primaryCredentialId, sshCredentialId)) assertMayApplySavedLogin(ctx, adapterId);
        // The secrets of the destination of the configuration backup never go to a host of the form.
        const locked = await storedSecretsRefusal(ctx, configId) ?? await savedLoginRefusal(ctx, primaryCredentialId, sshCredentialId);
        if (locked) return locked;

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
            ? await applyStoredSecrets(adapterId, configId, { ...config }, { primaryCredentialId, sshCredentialId })
            : { ...config };

        const mergedConfig = await overlayCredentialsOnConfig(
            adapterId,
            submittedConfig,
            primaryCredentialId ?? null,
            sshCredentialId ?? null
        );

        // Written once the read ran, whether the server answered or not, like the test of a connection.
        const databases = await auditedDatabasesRead(ctx, { sourceId: configId, adapterId }, () =>
            answerOf(adapterId, "list databases", () => withHost(adapter, mergedConfig, (host) => listDatabases(mergedConfig, host))));

        return NextResponse.json({ success: true, databases });

    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        // What the server or the adapter said is what the form shows, anything else stays in the log.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        log.error("Listing the databases of a form failed", {}, wrapError(error));
        return NextResponse.json({ success: false, message: "The databases could not be listed. The log of DBackup has the details." }, { status: 500 });
    }
}
