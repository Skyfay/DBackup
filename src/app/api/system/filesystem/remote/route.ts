import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { assertMayApplySavedLogin } from "@/lib/auth/saved-login-access";
import { assertConfigOffHost } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { PermissionError, ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { listRemoteDirectory } from "@/services/system/filesystem-service";

registerAdapters();

const log = logger.child({ route: "filesystem/remote" });

/**
 * Lists a directory on a server over SFTP, for a path field of the connection form whose file
 * lives there, like an SQLite database in SSH mode. It logs in with the config of the form, so it
 * needs the right to change connections of that kind in one tenant, like the form itself, and the
 * config may not reach the server DBackup runs on outside the platform, see `assertConfigOffHost`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        const { config, path, adapterId, sshCredentialId } = await req.json();
        const manage = typeof adapterId === "string" ? getManagePermissionForAdapter(adapterId) : null;
        if (!manage) return NextResponse.json({ success: false, error: "Unknown connection type" }, { status: 400 });
        checkPermissionWithContext(ctx, manage);
        tenantOf(ctx);
        if (sshCredentialId) assertMayApplySavedLogin(ctx, adapterId);
        // A saved login is checked again once it lies over the config, see `overlayCredentialsOnConfig`.
        if (config && typeof config === "object") await assertConfigOffHost(adapterId, config);

        const data = await listRemoteDirectory({ config, path, adapterId, sshCredentialId });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        // The server's own message, like a refused login or a missing folder, says what to fix.
        log.error("SSH browse error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "SSH Connection failed" }, { status: 500 });
    }
}
