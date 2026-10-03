import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { AuthenticationError, PermissionError, ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { listRemoteDirectory } from "@/services/system/filesystem-service";

registerAdapters();

const log = logger.child({ route: "filesystem/remote" });

/** Lists a directory on a server over SFTP, for a path field whose file lives there. */
export async function POST(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.SETTINGS.READ);
        const { config, path, adapterId, sshCredentialId } = await req.json();
        const data = await listRemoteDirectory({ config, path, adapterId, sshCredentialId });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof AuthenticationError) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        // The server's own message, like a refused login or a missing folder, says what to fix.
        log.error("SSH browse error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "SSH Connection failed" }, { status: 500 });
    }
}
