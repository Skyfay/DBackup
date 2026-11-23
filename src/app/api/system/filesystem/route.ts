import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { checkPlatformAdmin } from "@/lib/auth/access-control";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { logger } from "@/lib/logging/logger";
import { AuthenticationError, NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { BlockedPathError, listLocalDirectory } from "@/services/system/filesystem-service";
import { auditedProbe } from "@/services/adapters/probe-audit";

const log = logger.child({ route: "system/filesystem" });

/**
 * Lists a directory on the machine DBackup runs on, for the file browser of a path field.
 * Returns listings only, never file contents, and the blocklist of system paths lives in the
 * service. Only for a platform admin with a session in the home tenant, since only a platform admin
 * adds a connection that reaches that machine, see `host-local.ts`. An API key never acts as one.
 */
export async function GET(req: NextRequest) {
    try {
        const viewer = await checkPlatformAdmin();
        if (viewer.tenantId !== HOME_TENANT_ID) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        const requestedPath = req.nextUrl.searchParams.get("path") || "/";
        // Written once the browse ran, whether the folder was there or not.
        const data = await auditedProbe({ userId: viewer.id, authMethod: "session" }, "folder_browse", { local: true }, () => listLocalDirectory(requestedPath));
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof AuthenticationError) return unauthorized();
        if (error instanceof PermissionError || error instanceof BlockedPathError) {
            return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        }
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Path not found" }, { status: 404 });
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("Filesystem API error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to list directory" }, { status: 500 });
    }
}
