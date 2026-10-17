import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVersionHistory } from "@/services/system/db-version-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "adapters/version-history" });

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!hasPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW)) {
        return NextResponse.json({ error: "Permission denied: sources:view required" }, { status: 403 });
    }

    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    try {
        const history = await listVersionHistory(id, Number.isFinite(limit) ? limit : 100);
        return NextResponse.json({
            success: true,
            history: history.map((h) => ({
                id: h.id,
                previousVersion: h.previousVersion,
                newVersion: h.newVersion,
                edition: h.edition,
                detectedAt: h.detectedAt.toISOString(),
            })),
        });
    } catch (e: unknown) {
        log.error("Failed to load version history", { adapterConfigId: id }, wrapError(e));
        return NextResponse.json({ success: false, message: "Failed to load version history" }, { status: 500 });
    }
}
