import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { checkRestorePath } from "@/services/storage/restore-path-check";
import { isMissingStorage } from "@/services/storage/storage-lookup";
import { permissionRefusal } from "@/lib/server/permission-refusal";

/**
 * Checks whether a directory restore target already has content, for the Overwrite/Empty
 * badge in the restore UI. Answers "occupied" or "empty", or "unverified" when the storage
 * cannot list the path.
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

        return NextResponse.json(await checkRestorePath(params.id, targetPath));
    } catch (e: unknown) {
        const refused = permissionRefusal(e);
        if (refused) return refused;
        if (isMissingStorage(e)) {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
