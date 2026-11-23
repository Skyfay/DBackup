import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/execution" });

/** The id of a tenant, as `tenant` names it. */
const TenantIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/**
 * GET /api/storage/explorer/execution?path=...&tenant=...
 * The run that made one backup while History still has it, or null. The details of a backup ask for
 * it when they open. In All tenants `tenant` names the tenant of the backup, since two tenants can
 * hold a backup of the same path. Inside a tenant every run is of that tenant anyway, so `tenant`
 * counts only there.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const path = req.nextUrl.searchParams.get("path");
        if (!path) return NextResponse.json({ success: false, error: "The path of a backup is required" }, { status: 400 });
        const tenant = req.nextUrl.searchParams.get("tenant");
        const tenantId = TenantIdSchema.safeParse(tenant);
        if (tenant && !tenantId.success) return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });
        const data = await storageExplorerService.getExecution(path, ctx.allTenants && tenantId.success ? tenantId.data : null);
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the run of a backup", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the run" }, { status: 500 });
    }
}
