import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError } from "@/lib/logging/errors";
import { refusedUnless, requestRefusal } from "@/lib/server/permission-refusal";
import { getSavedConnection } from "@/services/adapters/adapter-list";
import { browseSavedFolders, HOST_FOLDER_PICKERS, savedConnectionReachesHost } from "@/services/adapters/location-browse-service";
import { auditedProbe } from "@/services/adapters/probe-audit";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/browse" });

/**
 * GET /api/adapters/[id]/browse?path=<relative-subpath>
 * Lists the immediate child directories of `path` within a saved storage adapter's
 * configured root, for the directory-source folder tree picker (job form). Scoped to
 * that one adapter's own root - never the host filesystem - which is why this uses
 * DESTINATIONS.READ (the permission that already governs viewing/using saved storage
 * adapter configs) rather than SETTINGS.READ (arbitrary host-disk/SSH browsing). A connection
 * that reaches the server DBackup runs on, like a Local Filesystem, lists folders of that server,
 * so it also takes the right to pick them, in a job or a restore, see `HOST_FOLDER_PICKERS`.
 */
export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.READ));
    if (refused) return refused;

    const params = await props.params;
    const subPath = req.nextUrl.searchParams.get("path") ?? "";

    const source = await getSavedConnection(params.id, "storage");
    if (!source) {
        return NextResponse.json({ success: false, error: "Storage adapter not found" }, { status: 404 });
    }

    if (await savedConnectionReachesHost(source.id)) {
        const picker = refusedUnless(() => checkAnyPermissionWithContext(ctx, HOST_FOLDER_PICKERS));
        if (picker) return picker;
    }

    try {
        // Written once the browse ran, whether the server answered or not, like the browse of a form.
        const entries = await auditedProbe(ctx, "folder_browse", { adapterId: source.adapterId, record: { id: source.id, name: source.name } }, () => browseSavedFolders(source, subPath));
        if (!entries) {
            return NextResponse.json({ success: true, supported: false, data: { path: subPath, entries: [] } });
        }
        return NextResponse.json({ success: true, supported: true, data: { path: subPath, entries } });
    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        log.error("Directory browse failed", { adapterConfigId: params.id, subPath }, wrapError(error));
        // What the server or the adapter said is what the picker shows, anything else stays in the log.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        return NextResponse.json({ success: false, error: "The folders could not be listed. The log of DBackup has the details." }, { status: 500 });
    }
}
