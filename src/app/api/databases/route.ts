import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { databaseExplorerService } from "@/services/databases/database-explorer-service";

const log = logger.child({ route: "databases" });

/**
 * GET /api/databases
 * Every database of every database connection as DBackup last read them, for the Database
 * Explorer. The jobs that back each up and its last backup come along for a viewer who may see jobs.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        const data = await databaseExplorerService.getOverview({ withJobs: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ) });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the databases", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the databases" }, { status: 500 });
    }
}
