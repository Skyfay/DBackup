import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { assertMayApplySavedLogin } from "@/lib/auth/saved-login-access";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { assertConfigOffHost } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { AdapterError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { listRemoteDirectory } from "@/services/system/filesystem-service";
import { auditedProbe } from "@/services/adapters/probe-audit";

registerAdapters();

const log = logger.child({ route: "filesystem/remote" });

/** What the browse answers when it fails for a reason of DBackup rather than of the server. */
const REMOTE_BROWSE_FAILED = "The folders could not be listed. The log of DBackup has the details.";

/**
 * Lists a directory on a server over SFTP, for a path field of the connection form whose file
 * lives there, like an SQLite database in SSH mode. It logs in with the config of the form, so it
 * needs the right to change connections of that kind in one tenant, like the form itself, and the
 * config may not reach the server DBackup runs on for anyone but a platform admin, see `assertConfigOffHost`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        const { config, path, adapterId, sshCredentialId } = await req.json();
        const manage = typeof adapterId === "string" ? getManagePermissionForAdapter(adapterId) : null;
        if (!manage) return NextResponse.json({ success: false, error: "Unknown connection type" }, { status: 400 });
        checkPermissionWithContext(ctx, manage);
        tenantOf(ctx);
        if (sshCredentialId) assertMayApplySavedLogin(ctx, adapterId);
        // The logins of the destination of the configuration backup never sign in to a host of the form.
        const locked = await savedLoginRefusal(ctx, sshCredentialId);
        if (locked) return locked;
        // A saved login is checked again once it lies over the config, see `overlayCredentialsOnConfig`.
        if (config && typeof config === "object") await assertConfigOffHost(adapterId, config);

        // Written once the browse ran, whether the server answered or not, like the test of a connection.
        const data = await auditedProbe(ctx, "folder_browse", { adapterId, host: config?.host }, () =>
            listRemoteDirectory({ config, path, adapterId, sshCredentialId }));
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        // The server's own message, like a refused login or a missing folder, says what to fix.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        log.error("SSH browse error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: REMOTE_BROWSE_FAILED }, { status: 500 });
    }
}
