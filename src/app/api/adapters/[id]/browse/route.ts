import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import type { StorageAdapter } from "@/lib/core/interfaces";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/browse" });

/**
 * GET /api/adapters/[id]/browse?path=<relative-subpath>
 * Lists the immediate child directories of `path` within a saved storage adapter's
 * configured root, for the directory-source folder tree picker (job form). Scoped to
 * that one adapter's own root - never the host filesystem - which is why this uses
 * DESTINATIONS.READ (the permission that already governs viewing/using saved storage
 * adapter configs) rather than SETTINGS.READ (arbitrary host-disk/SSH browsing).
 */
export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.READ);

    const params = await props.params;
    const subPath = req.nextUrl.searchParams.get("path") ?? "";

    const adapterConfig = await prisma.adapterConfig.findUnique({
        where: { id: params.id },
    });

    if (!adapterConfig || adapterConfig.type !== "storage") {
        return NextResponse.json({ success: false, error: "Storage adapter not found" }, { status: 404 });
    }

    const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter | undefined;
    if (!adapter?.browseDirectories) {
        return NextResponse.json({ success: true, supported: false, data: { path: subPath, entries: [] } });
    }

    try {
        const config = await resolveAdapterConfig(adapterConfig);
        const entries = await adapter.browseDirectories(config, subPath);
        return NextResponse.json({ success: true, supported: true, data: { path: subPath, entries } });
    } catch (error: unknown) {
        log.error("Directory browse failed", { adapterConfigId: params.id, subPath }, wrapError(error));
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
