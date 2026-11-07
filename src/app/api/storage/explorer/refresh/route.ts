import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { destinationAuditName } from "@/services/storage/backup-audit";
import { logProbe } from "@/services/adapters/probe-audit";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/refresh" });

registerAdapters();

const RefreshSchema = z.object({ destinationIds: z.array(z.string().min(1)).min(1).max(200) });

/**
 * POST /api/storage/explorer/refresh
 * Compares the listed destinations with the storage in the background, for Check now. Answers at
 * once with the destinations being listed, the page asks for the result until they are done. The
 * audit log notes the destinations a listing started for as `storage_check`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        // In a tenant, All tenants only reads and starts no listing of every destination.
        tenantOf(ctx);
        const parsed = RefreshSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: "Name the destinations to check" }, { status: 400 });

        const listing = await storageExplorerService.checkNow(parsed.data.destinationIds);
        // The listings run in the background, so the entry notes the destinations they started for.
        if (listing.length > 0) {
            const names = (await Promise.all(listing.map((id) => destinationAuditName(id)))).filter((name): name is string => name !== null);
            await logProbe(ctx, "storage_check", { names }, true);
        }
        return NextResponse.json({ success: true, data: { listing } });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to check the destinations", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The destinations could not be checked" }, { status: 500 });
    }
}
