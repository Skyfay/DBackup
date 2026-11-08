import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkAnyPermissionWithContext, checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { logDatabasesAssigned } from "@/services/tenant/assignment-audit";
import { databaseAssignmentService } from "@/services/tenant/database-assignments";
import { platformGroupService } from "@/services/user/platform-group-service";
import { unauthorized } from "@/lib/server/unauthorized";

const log = logger.child({ route: "adapters/[id]/database-assignments" });

const BodySchema = z.object({
    assignments: z.array(z.object({
        database: z.string().trim().min(1).max(200),
        /** The tenant the database belongs to, null to take it back. */
        tenantId: z.string().min(1).max(200).nullable(),
        /** ISO date the customer's backups start, now when left out. */
        validFrom: z.coerce.date().optional(),
    })).min(1).max(500),
});

function failure(error: unknown, fallback: string) {
    if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Database source not found" }, { status: 404 });
    if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    log.error(fallback, {}, wrapError(error));
    return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

/**
 * GET /api/adapters/[id]/database-assignments
 * The databases of a shared server with the tenant each belongs to, the assignments and the rules,
 * for whoever may see the shared databases: a session, or an API key made in a tenant that shares, see
 * `keyPlatformPermissions`. `customers` lists the tenants the caller may give a database to, those
 * the platform group of the person or of the owner of the key reaches, and a tenant beyond it holds
 * as `TENANT_BEYOND_REACH`, without its id and its name.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();
    const { id } = await props.params;
    try {
        checkAnyPermissionWithContext(ctx, [SEE_SHARING_PERMISSION, SHARE_PERMISSION]);
        const reach = await platformGroupService.reachOf(ctx.userId);
        return NextResponse.json({ success: true, data: await databaseAssignmentService.forSource(id, new Date(), reach) });
    } catch (error: unknown) {
        return failure(error, "The assignments could not be read");
    }
}

/**
 * PUT /api/adapters/[id]/database-assignments
 * Gives databases of a shared server to tenants, many at once, for a hosting panel that creates
 * them. A null tenant takes a database back. Someone of a platform group of some tenants, and a
 * key of theirs, gives to and takes from the tenants it reaches only.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();
    const { id } = await props.params;
    try {
        checkPermissionWithContext(ctx, SHARE_PERMISSION);
        // A change happens in the tenant of the server, All tenants only reads.
        tenantOf(ctx);
        const parsed = BodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

        const changes = parsed.data.assignments.map((entry) => ({ databaseName: entry.database, tenantId: entry.tenantId, validFrom: entry.validFrom }));
        const reach = await platformGroupService.reachOf(ctx.userId);
        const result = await databaseAssignmentService.assign(id, changes, ctx.userId, new Date(), reach);
        if (result.changed > 0) {
            await logDatabasesAssigned({ id: ctx.userId, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null }, id, changes, result.tenants);
        }
        return NextResponse.json({ success: true, data: { changed: result.changed } });
    } catch (error: unknown) {
        return failure(error, "The databases could not be assigned");
    }
}
