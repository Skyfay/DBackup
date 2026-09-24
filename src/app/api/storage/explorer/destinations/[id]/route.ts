import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/destinations" });

registerAdapters();

/**
 * GET /api/storage/explorer/destinations/[id]
 * The backups of one destination, each with its job and its copies at the other destinations.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const { id } = await props.params;
        const data = await storageExplorerService.getDestinationView(id);
        if (!data) return NextResponse.json({ success: false, error: "Destination not found" }, { status: 404 });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the backups of a destination", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the backups" }, { status: 500 });
    }
}
