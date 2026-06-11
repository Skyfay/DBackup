import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage/storage-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/files" });

// Ensure adapters are registered in this route handler environment
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const params = await props.params;
        const url = new URL(req.url);
        const typeFilter = url.searchParams.get("typeFilter") || undefined;
        const bypassCache = url.searchParams.get("refresh") === "true";

        // Delegate logic to Service
        const enrichedFiles = await storageService.listFilesWithMetadata(params.id, typeFilter, bypassCache);

        return NextResponse.json(enrichedFiles);

    } catch (error: unknown) {
        const resolvedParams = await props.params.catch(() => ({ id: "unknown" }));
        log.error("List files error", { storageId: resolvedParams.id }, wrapError(error));

        // Handle specific service errors (like Not Found) with correct status mappings
        const errorMessage = getErrorMessage(error) || "An unknown error occurred";
        if (errorMessage.includes("not found")) {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        if (errorMessage.includes("not a storage adapter")) {
            return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DELETE);

        const { path } = await req.json();
        const params = await props.params;

        if (!path) {
            return NextResponse.json({ error: "Path is required" }, { status: 400 });
        }

        // Delegate logic to Service
        const success = await storageService.deleteFile(params.id, path);

        if (!success) {
             return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
        }

        // Refresh storage stats cache after file deletion (non-blocking)
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache().catch(() => {});
        });

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        const resolvedParams = await props.params.catch(() => ({ id: "unknown" }));
        log.error("Delete file error", { storageId: resolvedParams.id }, wrapError(error));
         const errorMessage = getErrorMessage(error) || "An unknown error occurred";

         if (errorMessage.includes("not found")) {
             return NextResponse.json({ error: errorMessage }, { status: 404 });
         }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
