import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/execution" });

/**
 * GET /api/storage/explorer/execution?path=...
 * The run that made one backup while History still has it, or null. The details of a backup ask for
 * it when they open.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const path = req.nextUrl.searchParams.get("path");
        if (!path) return NextResponse.json({ success: false, error: "The path of a backup is required" }, { status: 400 });
        const data = await storageExplorerService.getExecution(path);
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the run of a backup", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the run" }, { status: 500 });
    }
}
