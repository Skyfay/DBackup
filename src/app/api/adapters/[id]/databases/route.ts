import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registerAdapters } from "@/lib/adapters";
import { getSavedConnection } from "@/services/adapters/adapter-list";
import { listSourceDatabases } from "@/services/databases/database-read-service";
import { refusedUnless } from "@/lib/server/permission-refusal";

registerAdapters();

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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        const databases = await listSourceDatabases(source);
        return NextResponse.json({ success: true, databases });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
