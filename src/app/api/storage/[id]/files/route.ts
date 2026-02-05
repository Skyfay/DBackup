import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage-service";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "storage/files" });

// Ensure adapters are registered in this route handler environment
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.STORAGE.READ);

        const params = await props.params;
        const url = new URL(req.url);
        const typeFilter = url.searchParams.get("typeFilter") || undefined;

        // Delegate logic to Service
        const enrichedFiles = await storageService.listFilesWithMetadata(params.id, typeFilter);

        return NextResponse.json(enrichedFiles);

    } catch (error: unknown) {
        log.error("List files error", { storageId: params.id }, wrapError(error));

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
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.STORAGE.DELETE);

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

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        log.error("Delete file error", { storageId: params.id }, wrapError(error));
         const errorMessage = getErrorMessage(error) || "An unknown error occurred";

         if (errorMessage.includes("not found")) {
             return NextResponse.json({ error: errorMessage }, { status: 404 });
         }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
