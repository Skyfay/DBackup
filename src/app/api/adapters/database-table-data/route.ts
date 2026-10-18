import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assertMayReadFormConfig } from "@/lib/auth/form-config-access";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { z } from "zod";
import { readTableData, type ReadRefusal } from "@/services/databases/database-read-service";

registerAdapters();

const MAX_PAGE_SIZE = 200;

const BodySchema = z.intersection(
    z.union([
        z.object({ sourceId: z.string().min(1) }),
        z.object({ adapterId: z.string().min(1), config: z.record(z.string(), z.unknown()) }),
    ]),
    z.object({
        database: z.string().min(1),
        table: z.string().min(1),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
        search: z.string().optional(),
        searchColumn: z.string().optional(),
        matchMode: z.enum(["contains", "equals", "starts", "ends"]).optional(),
        sortBy: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
    })
);

/** What the API answers a read that never reached the server with. */
const REFUSALS: Record<ReadRefusal, { message: string; status: number }> = {
    "source-missing": { message: "Source not found", status: 404 },
    "adapter-missing": { message: "Adapter not found", status: 404 },
    "unsupported": { message: "This adapter does not support reading table data.", status: 200 },
};

/**
 * POST /api/adapters/database-table-data
 *
 * Returns paginated row data from a table or collection for a given source.
 * Accepts either a saved sourceId or a raw adapterId + config pair. A raw config needs the right
 * to change connections of its kind, see `assertMayReadFormConfig`.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);

        const raw = await req.json();
        const parsed = BodySchema.safeParse(raw);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request body", errors: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const body = parsed.data;
        if (!("sourceId" in body)) assertMayReadFormConfig(ctx, body.adapterId);
        const target = "sourceId" in body ? { sourceId: body.sourceId } : { adapterId: body.adapterId, config: body.config };

        const outcome = await readTableData(target, {
            database: body.database,
            table: body.table,
            page: body.page,
            pageSize: body.pageSize,
            search: body.search,
            searchColumn: body.searchColumn,
            matchMode: body.matchMode,
            sortBy: body.sortBy,
            sortDir: body.sortDir,
        });
        if (!outcome.ok) {
            const { message, status } = REFUSALS[outcome.reason];
            return NextResponse.json({ success: false, message }, { status });
        }

        return NextResponse.json({ success: true, ...outcome.value });

    } catch (error: unknown) {
        const refusal = permissionRefusal(error);
        if (refusal) return refusal;
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
