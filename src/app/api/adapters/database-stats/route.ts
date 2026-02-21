import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import prisma from "@/lib/prisma";
import { decryptConfig } from "@/lib/crypto";

// Ensure adapters are registered
registerAdapters();

/**
 * POST /api/adapters/database-stats
 *
 * Returns databases with size and table count information for a given source.
 * Accepts either raw config (adapterId + config) or a saved source ID (sourceId).
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);

    try {
        const body = await req.json();
        const { adapterId, config, sourceId } = body;

        let resolvedAdapterId = adapterId;
        let resolvedConfig = config;

        // If sourceId is provided, look up the adapter config from DB
        if (sourceId && !config) {
            const source = await prisma.adapterConfig.findUnique({
                where: { id: sourceId }
            });

            if (!source) {
                return NextResponse.json({ success: false, message: "Source not found" }, { status: 404 });
            }

            resolvedAdapterId = source.adapterId;
            resolvedConfig = decryptConfig(JSON.parse(source.config));
        }

        if (!resolvedAdapterId || !resolvedConfig) {
            return NextResponse.json({ success: false, message: "Missing adapterId/config or sourceId" }, { status: 400 });
        }

        const adapter = registry.get(resolvedAdapterId);

        if (!adapter) {
            return NextResponse.json({ success: false, message: "Adapter not found" }, { status: 404 });
        }

        // Prefer getDatabasesWithStats, fall back to getDatabases
        let databases: DatabaseInfo[];

        if (adapter.getDatabasesWithStats) {
            databases = await adapter.getDatabasesWithStats(resolvedConfig);
        } else if (adapter.getDatabases) {
            const names = await adapter.getDatabases(resolvedConfig);
            databases = names.map(name => ({ name }));
        } else {
            return NextResponse.json({ success: false, message: "This adapter does not support listing databases." });
        }

        // Also retrieve server version/edition for compatibility checks
        let serverVersion: string | undefined;
        let serverEdition: string | undefined;

        if (adapter.test) {
            try {
                const testResult = await adapter.test(resolvedConfig) as { success: boolean; version?: string; edition?: string };
                if (testResult.success) {
                    serverVersion = testResult.version;
                    serverEdition = testResult.edition;
                }
            } catch {
                // Non-critical — version info is optional
            }
        }

        return NextResponse.json({ success: true, databases, serverVersion, serverEdition });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
