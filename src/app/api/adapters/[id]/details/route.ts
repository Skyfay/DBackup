import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { connectionNotFound, seesConnectionType } from "@/lib/server/connection-access";
import { getAdapterTypes } from "@/services/adapters/adapter-service";
import { getConnectionDetails } from "@/services/adapters/connection-details";
import { providedConnection } from "@/services/sharing/provided";

const log = logger.child({ route: "adapters/details" });

/**
 * GET /api/adapters/[id]/details
 * The details panel of one connection: its jobs and templates, the last passed health
 * check, the mean response time and the version history. The jobs need jobs:read on top.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const { id } = await props.params;
    try {
        // The permission depends on the kind of connection, so only its type is read first. A
        // connection another tenant shares with this one shows with what this tenant does with it.
        // One the caller may not read answers like a missing one, so the answer never names its kind.
        const [own] = await getAdapterTypes([id]);
        const type = own ?? (ctx.tenantId ? (await providedConnection(id, ctx.tenantId))?.type : undefined);
        if (!seesConnectionType(ctx, type)) return connectionNotFound();

        const details = await getConnectionDetails(id, {
            includeUsage: hasPermissionWithContext(ctx, PERMISSIONS.JOBS.READ),
        });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Loading connection details failed", { adapterId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The details of the connection could not be loaded. The log of DBackup has the details." }, { status: 500 });
    }
}
