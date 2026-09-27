import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serverExplorerService } from "@/services/databases/server-explorer-service";

const log = logger.child({ route: "databases/servers/[id]" });

registerAdapters();

/**
 * GET /api/databases/servers/[id]
 * One database server for its page in the Database Explorer, with the share of its health checks
 * of the last 30 days that passed.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        const data = await serverExplorerService.getServer(id, { withBackups: hasPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ) });
        if (!data) return NextResponse.json({ success: false, error: "Server not found" }, { status: 404 });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load a server", { serverId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the server" }, { status: 500 });
    }
}
