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
import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { connectionPlace } from "@/services/audit/record-names";
import { listTables, type ReadRefusal } from "@/services/databases/database-read-service";

registerAdapters();

const log = logger.child({ route: "adapters/database-tables" });

const BodySchema = z.union([
    z.object({ sourceId: z.string().min(1), database: z.string().min(1) }),
    z.object({ adapterId: z.string().min(1), config: z.record(z.string(), z.unknown()), database: z.string().min(1) }),
]);

/** What the API answers a read that never reached the server with. */
const REFUSALS: Record<ReadRefusal, { message: string; status: number }> = {
    "source-missing": { message: "Source not found", status: 404 },
    "adapter-missing": { message: "Adapter not found", status: 404 },
    "unsupported": { message: "This adapter does not support listing tables.", status: 200 },
};

/**
 * POST /api/adapters/database-tables
 *
 * Returns the list of tables/collections inside a database for a given source.
 * Accepts either a saved sourceId or a raw adapterId + config pair. A raw config needs the right
 * to change connections of its kind, see `assertMayReadFormConfig`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);

        const raw = await req.json();
        const parsed = BodySchema.safeParse(raw);

        if (!parsed.success) {
            return NextResponse.json({ success: false, message: "Invalid request body" }, { status: 400 });
        }

        const body = parsed.data;
        if (!("sourceId" in body)) assertMayReadFormConfig(ctx, body.adapterId);
        const target = "sourceId" in body ? { sourceId: body.sourceId } : { adapterId: body.adapterId, config: body.config };

        const outcome = await listTables(target, body.database);
        if (!outcome.ok) {
            const { message, status } = REFUSALS[outcome.reason];
            return NextResponse.json({ success: false, message }, { status });
        }

        // What someone read of a database goes into the log, named by the source, or the type of a form not saved yet.
        // In the log of the tenant of the source, also from All tenants, where no tenant runs.
        const source = "sourceId" in body ? await connectionPlace(body.sourceId) : null;
        await auditService.logFor(ctx, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.SOURCE, {
            action: "table_list",
            name: source?.name ?? ("adapterId" in body ? body.adapterId : null),
            database: body.database,
        }, "sourceId" in body ? body.sourceId : undefined, { tenantId: source?.tenantId });

        return NextResponse.json({ success: true, tables: outcome.value });

    } catch (error: unknown) {
        const refusal = requestRefusal(error);
        if (refusal) return refusal;
        // What the server or the adapter said is what the form shows, anything else stays in the log.
        if (error instanceof AdapterError) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        log.error("Listing the tables failed", {}, wrapError(error));
        return NextResponse.json({ success: false, message: "The tables could not be listed. The log of DBackup has the details." }, { status: 500 });
    }
}
