import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assertMayReadFormConfig } from "@/lib/auth/form-config-access";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { readDatabaseStats, type StatsRefusal } from "@/services/databases/database-read-service";

// Ensure adapters are registered
registerAdapters();

/** What the API answers a read that never reached the server with. */
const REFUSALS: Record<StatsRefusal, { message: string; status: number }> = {
    "source-missing": { message: "Source not found", status: 404 },
    "incomplete": { message: "Missing adapterId/config or sourceId", status: 400 },
    "adapter-missing": { message: "Adapter not found", status: 404 },
    "unsupported": { message: "This adapter does not support listing databases.", status: 200 },
};

/**
 * POST /api/adapters/database-stats
 *
 * Returns databases with size and table count information for a given source.
 * Accepts either raw config (adapterId + config) or a saved source ID (sourceId). A raw config
 * needs the right to change connections of its kind, see `assertMayReadFormConfig`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);

        const body = await req.json();
        const { adapterId, config, sourceId } = body;
        // The service runs a config that comes along in place of the saved source.
        if (config) {
            if (typeof adapterId !== "string" || !adapterId) return NextResponse.json({ success: false, message: REFUSALS.incomplete.message }, { status: 400 });
            assertMayReadFormConfig(ctx, adapterId);
        }

        const outcome = await readDatabaseStats({ adapterId, config, sourceId });
        if (!outcome.ok) {
            const { message, status } = REFUSALS[outcome.reason];
            return NextResponse.json({ success: false, message }, { status });
        }

        const { databases, serverVersion, serverEdition } = outcome.value;
        return NextResponse.json({ success: true, databases, serverVersion, serverEdition });

    } catch (error: unknown) {
        const refusal = permissionRefusal(error);
        if (refusal) return refusal;
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
