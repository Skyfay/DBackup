import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/runs" });

registerAdapters();

/**
 * GET /api/storage/explorer/runs
 * Every backup of every job, newest first, each with its copies at every destination. The page
 * filters them by job and by destination.
 */
export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const data = await storageExplorerService.getBackups();
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the backups", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the backups" }, { status: 500 });
    }
}
