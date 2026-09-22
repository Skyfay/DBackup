import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { getReadPermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getAdapterTypes } from "@/services/adapters/adapter-service";
import { getHealthHistory } from "@/services/adapters/health-history";

const log = logger.child({ route: "adapters/health-history" });

/** A week of checks at one a minute. */
const MAX_LIMIT = 10_080;

/**
 * GET /api/adapters/[id]/health-history
 * The latest health checks of one connection, with how they went and since when its status
 * holds. Reading them needs the read permission of the connection's kind, like its details.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100") || 100, 1), MAX_LIMIT);
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
    if (from && Number.isNaN(from.getTime())) {
        return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
    }

    try {
        // The permission depends on the kind of connection, so only its type is read first.
        const [type] = await getAdapterTypes([id]);
        if (!type) return NextResponse.json({ error: "Adapter not found" }, { status: 404 });
        checkPermissionWithContext(ctx, getReadPermissionForAdapterType(type));

        return NextResponse.json(await getHealthHistory(id, { limit, from }));
    } catch (e: unknown) {
        if (e instanceof PermissionError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        log.error("Failed to fetch health history", { adapterId: id }, wrapError(e));
        return NextResponse.json({ error: "Failed to fetch health data" }, { status: 500 });
    }
}
