import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { configBackupRefusal } from "@/lib/server/config-backup-guard";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ValidationError, wrapError, getErrorMessage } from "@/lib/logging/errors";
import { browseArchive } from "@/services/storage/backup-contents";
import { isMissingStorage } from "@/services/storage/storage-lookup";

const log = logger.child({ route: "storage/browse-archive" });

const BrowseSchema = z.object({
    /** Remote path of the backup archive, without any sidecar suffix. */
    file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    /** JobSource id of the directory source to browse. Omit to list the sources themselves. */
    jobSourceId: z.string().min(1).optional(),
    /** Directory to list, relative to that source's root. Omit for the root. */
    prefix: z.string().optional(),
    /** Vault profile to open the backup with, when the one it names does not fit. */
    profileIdOverride: z.string().min(1).optional(),
});

/**
 * Lists one directory level inside a backup, reading only the archive's index sidecar.
 *
 * Deliberately one level per request: a backup can hold hundreds of thousands of files, and
 * shipping the whole tree to the browser to render one folder would be far more expensive
 * than the lazy expansion the UI actually does.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await props.params;

    try {
        // Read-only: listing what a backup holds is part of restoring it and of downloading from it.
        checkAnyPermissionWithContext(ctx, [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD]);

        const parsed = BrowseSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }
        const { file, jobSourceId, prefix, profileIdOverride } = parsed.data;
        const keyOverride = profileIdOverride ? { profileId: profileIdOverride } : undefined;
        const configBackup = await configBackupRefusal(ctx, id, file);
        if (configBackup) return configBackup;

        const listing = await browseArchive(id, file, { jobSourceId, prefix, keyOverride });
        if (!listing) {
            return NextResponse.json({ success: false, error: "Could not read the backup's file index" }, { status: 502 });
        }

        return NextResponse.json({ success: true, data: listing });
    } catch (e: unknown) {
        const refused = permissionRefusal(e);
        if (refused) return refused;
        const keyRequired = keyRequiredResponse(e);
        if (keyRequired) return keyRequired;

        if (isMissingStorage(e)) {
            return NextResponse.json({ success: false, error: "Storage adapter not found" }, { status: 404 });
        }
        // The only other thing a browse can miss is the metadata of the backup.
        if (e instanceof NotFoundError) {
            return NextResponse.json({ success: false, error: "Backup metadata not found" }, { status: 404 });
        }
        // A storage that cannot read metadata, or a backup without a file index.
        if (e instanceof ValidationError) {
            return NextResponse.json({ success: false, error: e.message }, { status: 400 });
        }

        log.error("Failed to browse archive", { configId: id }, wrapError(e));
        return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
    }
}
