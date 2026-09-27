import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { databaseExplorerService } from "@/services/databases/database-explorer-service";

const log = logger.child({ route: "databases/runs" });

const QuerySchema = z.object({ from: z.coerce.date(), until: z.coerce.date() }).refine((query) => query.from <= query.until, { message: "from must not be after until" });

/**
 * GET /api/databases/runs?from=...&until=...
 * The runs of the jobs that back up databases between two times, the version changes of the
 * servers then, and the runs the schedules plan until `until`. For the timeline of the Database Explorer.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
        const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
        if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid time span" }, { status: 400 });
        const data = await databaseExplorerService.getRuns(parsed.data.from, parsed.data.until);
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the runs of the databases", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the runs" }, { status: 500 });
    }
}
