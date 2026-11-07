import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assertMayReadFormConfig } from "@/lib/auth/form-config-access";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError } from "@/lib/logging/errors";
import { readDatabaseStats, type StatsRefusal } from "@/services/databases/database-read-service";
import { logDatabasesRead } from "@/services/databases/databases-read-audit";

// Ensure adapters are registered
registerAdapters();

const log = logger.child({ route: "adapters/database-stats" });

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
        return unauthorized();
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

        let outcome: Awaited<ReturnType<typeof readDatabaseStats>>;
        try {
            outcome = await readDatabaseStats({ adapterId, config, sourceId });
        } catch (error: unknown) {
            // The read ran and the server did not answer, which the log keeps like a test of a connection.
            await logDatabasesRead(ctx, { sourceId, adapterId }, false);
            throw error;
        }
        // A read that never reached the server writes nothing.
        if (outcome.ok) await logDatabasesRead(ctx, { sourceId, adapterId }, true);
        if (!outcome.ok) {
            const { message, status } = REFUSALS[outcome.reason];
            return NextResponse.json({ success: false, message }, { status });
        }

        const { databases, serverVersion, serverEdition } = outcome.value;
        return NextResponse.json({ success: true, databases, serverVersion, serverEdition });

    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        // What the server or the adapter said is what the form shows, anything else stays in the log.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        log.error("Reading the databases with their sizes failed", {}, wrapError(error));
        return NextResponse.json({ success: false, message: "The databases could not be read. The log of DBackup has the details." }, { status: 500 });
    }
}
