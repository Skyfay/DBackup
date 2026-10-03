import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serverExplorerService } from "@/services/databases/server-explorer-service";

const log = logger.child({ route: "databases/servers" });

registerAdapters();

/**
 * GET /api/databases/servers
 * Every database server for the Servers tab of the Database Explorer: where it runs, how fast it
 * answers and how many version changes the last 30 days brought. Its kept backups and whether it
 * is too old for the newest backups of its engine come along for a viewer who may see backups.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        const data = await serverExplorerService.getServers({ withBackups: hasPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ) });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the servers", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the servers" }, { status: 500 });
    }
}
