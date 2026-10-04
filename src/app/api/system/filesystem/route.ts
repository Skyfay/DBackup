import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { AuthenticationError, NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { BlockedPathError, listLocalDirectory } from "@/services/system/filesystem-service";

const log = logger.child({ route: "system/filesystem" });

/**
 * Lists a directory on the machine DBackup runs on, for the file browser of a path field.
 * An authenticated admin-only endpoint (settings:read) that returns listings only, never file
 * contents. The blocklist of system paths lives in the service.
 */
export async function GET(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.SETTINGS.READ);
        const requestedPath = req.nextUrl.searchParams.get("path") || "/";
        const data = await listLocalDirectory(requestedPath);
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof AuthenticationError) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        if (error instanceof PermissionError || error instanceof BlockedPathError) {
            return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        }
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Path not found" }, { status: 404 });
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("Filesystem API error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to list directory" }, { status: 500 });
    }
}
