import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { z } from "zod";
import { listTables, type ReadRefusal } from "@/services/databases/database-read-service";

registerAdapters();

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
 * Accepts either a saved sourceId or a raw adapterId + config pair.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);

    try {
        const raw = await req.json();
        const parsed = BodySchema.safeParse(raw);

        if (!parsed.success) {
            return NextResponse.json({ success: false, message: "Invalid request body" }, { status: 400 });
        }

        const body = parsed.data;
        const target = "sourceId" in body ? { sourceId: body.sourceId } : { adapterId: body.adapterId, config: body.config };

        const outcome = await listTables(target, body.database);
        if (!outcome.ok) {
            const { message, status } = REFUSALS[outcome.reason];
            return NextResponse.json({ success: false, message }, { status });
        }

        return NextResponse.json({ success: true, tables: outcome.value });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
