import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registerAdapters } from "@/lib/adapters";
import { getSavedConnection } from "@/services/adapters/adapter-list";
import { listSourceDatabases } from "@/services/databases/database-read-service";
import { auditedDatabasesRead } from "@/services/databases/databases-read-audit";
import { refusedUnless, requestRefusal } from "@/lib/server/permission-refusal";
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/databases" });

/**
 * GET /api/adapters/[id]/databases
 * Lists available databases for a saved database source adapter config.
 */
export async function GET(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW));
    if (refused) return refused;

    const params = await props.params;

    const source = await getSavedConnection(params.id, "database");
    if (!source) {
        return NextResponse.json({ error: "Database source not found" }, { status: 404 });
    }

    try {
        // An adapter that cannot list its databases answers with none.
        // Written once the read ran, whether the server answered or not, like the test of a connection.
        const databases = await auditedDatabasesRead(ctx, { sourceId: source.id, adapterId: source.adapterId }, () => listSourceDatabases(source));
        return NextResponse.json({ success: true, databases });
    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        // What the server or the adapter said is what the picker shows, anything else stays in the log.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        log.error("Listing the databases failed", { sourceId: source.id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The databases could not be listed. The log of DBackup has the details." }, { status: 500 });
    }
}
