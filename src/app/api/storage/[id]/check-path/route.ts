import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

registerAdapters();

/**
 * Checks whether a directory restore target already has content, for the Overwrite/Empty
 * badge in the restore UI. `list()` cannot distinguish "path does not exist yet" from
 * "path exists but is empty" (both return []), so the only signal available without a new
 * adapter interface member is: any files found -> "occupied", none found -> "empty".
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { path: targetPath } = body;

        if (typeof targetPath !== 'string' || targetPath.includes('..')) {
            return NextResponse.json({ error: "Invalid path" }, { status: 400 });
        }

        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: params.id } });
        if (!storageConfig || storageConfig.type !== "storage") {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }

        const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
        if (!storageAdapter) return NextResponse.json({ error: "Storage impl missing" }, { status: 500 });

        const sConf = await resolveAdapterConfig(storageConfig);

        try {
            const entries = await storageAdapter.list(sConf, targetPath);
            return NextResponse.json({ status: entries.length > 0 ? "occupied" : "empty", itemCount: entries.length });
        } catch {
            return NextResponse.json({ status: "unverified" });
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
