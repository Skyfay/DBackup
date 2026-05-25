import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";

registerAdapters();

const BodySchema = z.union([
    z.object({ sourceId: z.string().min(1), database: z.string().min(1) }),
    z.object({ adapterId: z.string().min(1), config: z.record(z.string(), z.unknown()), database: z.string().min(1) }),
]);

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
        const database = body.database;

        let resolvedAdapterId: string;
        let resolvedConfig: unknown;

        if ("sourceId" in body) {
            const source = await prisma.adapterConfig.findUnique({ where: { id: body.sourceId } });

            if (!source) {
                return NextResponse.json({ success: false, message: "Source not found" }, { status: 404 });
            }

            resolvedAdapterId = source.adapterId;
            resolvedConfig = await resolveAdapterConfig(source);
        } else {
            resolvedAdapterId = body.adapterId;
            resolvedConfig = body.config;
        }

        const adapter = registry.get(resolvedAdapterId) as DatabaseAdapter | undefined;

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        if (!adapter.getTables) {
            return NextResponse.json({ success: false, message: "This adapter does not support listing tables." });
        }

        const tables = await adapter.getTables(resolvedConfig, database);

        return NextResponse.json({ success: true, tables });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
