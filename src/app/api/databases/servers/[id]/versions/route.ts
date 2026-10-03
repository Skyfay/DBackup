import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serverExplorerService } from "@/services/databases/server-explorer-service";

const log = logger.child({ route: "databases/servers/[id]/versions" });

registerAdapters();

const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(50).default(5),
});

/**
 * GET /api/databases/servers/[id]/versions?page=1&size=5
 * One page of the versions a database server ran, newest first: when each came and from which,
 * and the backups made while it ran, with how many are still kept. The backups made need the
 * permission to see jobs, the kept ones the one to see backups.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
        if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid page" }, { status: 400 });
        const data = await serverExplorerService.getVersions(id, parsed.data.page, parsed.data.size, {
            withJobs: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ),
            withBackups: hasPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ),
        });
        if (!data) return NextResponse.json({ success: false, error: "Server not found" }, { status: 404 });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the versions of a server", { serverId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the versions" }, { status: 500 });
    }
}
