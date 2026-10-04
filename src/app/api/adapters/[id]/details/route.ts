import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { getReadPermissionForAdapterType, PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage, PermissionError, wrapError } from "@/lib/logging/errors";
import { getAdapterTypes } from "@/services/adapters/adapter-service";
import { getConnectionDetails } from "@/services/adapters/connection-details";

const log = logger.child({ route: "adapters/details" });

/**
 * GET /api/adapters/[id]/details
 * The details panel of one connection: its jobs and templates, the last passed health
 * check, the mean response time and the version history. The jobs need jobs:read on top.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await props.params;
    try {
        // The permission depends on the kind of connection, so only its type is read first.
        const [type] = await getAdapterTypes([id]);
        if (!type) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }
        checkPermissionWithContext(ctx, getReadPermissionForAdapterType(type));

        const details = await getConnectionDetails(id, {
            includeUsage: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ),
        });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Loading connection details failed", { adapterId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
