import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { databaseExplorerService } from "@/services/databases/database-explorer-service";
import { databaseListService } from "@/services/databases/database-list-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

const log = logger.child({ route: "databases/read" });

const BodySchema = z.object({ serverIds: z.array(z.string().min(1)).max(500).optional() });

/**
 * POST /api/databases/read
 * Reads the databases of the given connections, or of all of them, from the servers now instead
 * of waiting for the hourly read, then answers like GET /api/databases.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        // A read connects to the servers and writes their lists, so All tenants, which only reads,
        // would dial the servers of every tenant at once.
        tenantOf(ctx);
        const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
        const { serverIds } = parsed.data;
        const read = await databaseListService.readSources(serverIds);
        // Written once the read ran, naming the source when it was one, else how many it read.
        await auditService.logFor(ctx, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.SOURCE, {
            action: "databases_read",
            ...(read.length === 1 ? { name: read[0] } : {}),
            count: read.length,
            ...(serverIds ? {} : { all: true }),
        }, read.length === 1 && serverIds?.length === 1 ? serverIds[0] : undefined);
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
