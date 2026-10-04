import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { databaseExplorerService } from "@/services/databases/database-explorer-service";
import { databaseListService } from "@/services/databases/database-list-service";

const log = logger.child({ route: "databases/read" });

const BodySchema = z.object({ serverIds: z.array(z.string().min(1)).max(500).optional() });

/**
 * POST /api/databases/read
 * Reads the databases of the given connections, or of all of them, from the servers now instead
 * of waiting for the hourly read, then answers like GET /api/databases.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        await databaseListService.readSources(parsed.data.serverIds);
        const data = await databaseExplorerService.getOverview({ withJobs: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ) });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to read the databases", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to read the databases" }, { status: 500 });
    }
}
