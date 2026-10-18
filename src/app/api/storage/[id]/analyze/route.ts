
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { configBackupRefusal } from "@/lib/server/config-backup-guard";
import { analyzeBackup } from "@/services/storage/backup-contents";
import { isMissingStorage } from "@/services/storage/storage-lookup";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        // Read-only: listing what a backup holds is part of restoring it and of downloading from it.
        checkAnyPermissionWithContext(ctx, [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD]);

        const body = await req.json();
        // profileIdOverride: the vault profile the user picked after being asked for a key.
        // Every request that opens this backup carries it, because the one that raised the
        // question is rarely the last one that needs the answer.
        const { file, type, profileIdOverride } = body;
        const keyOverride = typeof profileIdOverride === "string" && profileIdOverride
            ? { profileId: profileIdOverride }
            : undefined;

        if (!file || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }
        const configBackup = await configBackupRefusal(ctx, params.id, file);
        if (configBackup) return configBackup;

        return NextResponse.json(await analyzeBackup(params.id, file, type, keyOverride));
    } catch (e: unknown) {
        const refused = permissionRefusal(e);
        if (refused) return refused;
        // A backup nobody holds the key for is answerable, so it is reported rather than
        // rendered as an archive with nothing in it.
        const keyRequired = keyRequiredResponse(e);
        if (keyRequired) return keyRequired;

        if (isMissingStorage(e)) {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
