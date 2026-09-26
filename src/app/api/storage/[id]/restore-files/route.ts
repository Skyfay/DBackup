import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { Readable } from "stream";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { planFileRestore, restoreFilesToStorage, FileRestoreInput } from "@/services/restore/file-restore";
import { openArchiveDownload, planArchiveDownload, type ArchiveDownload } from "@/services/restore/archive-download";
import { generateSelectionDownloadToken, consumeSelectionDownloadToken } from "@/lib/auth/download-tokens";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { attachmentDisposition } from "@/lib/server/content-disposition";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "storage/restore-files" });

const TargetSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("download") }),
    z.object({ kind: z.literal("origin") }),
    z.object({ kind: z.literal("storage"), configId: z.string().min(1), basePath: z.string().min(1) }),
]);

const RestoreFilesSchema = z.object({
    file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    /**
     * Omit together with `databases` to restore the complete snapshot. An entry without paths
     * means that whole source.
     */
    selections: z.array(z.object({
        src: z.string().min(1),
        paths: z.array(z.string().min(1)).min(1).optional(),
    })).min(1).optional(),
    /**
     * Database dumps to download, by name. Exactly one and no `selections` downloads that
     * dump on its own, anything else a tar.gz.
     */
    databases: z.array(z.string().min(1)).min(1).optional(),
    target: TargetSchema,
    /** Glob patterns whose matching files are left out of the restore entirely. */
    excludePatterns: z.array(z.string()).optional(),
    /** Resolve the selection and report its size without restoring anything. */
    dryRun: z.boolean().optional(),
    /** Vault profile to open the backup with, when the one it names does not fit. */
    profileIdOverride: z.string().min(1).optional(),
    /**
     * Validate the selection and hand back a token instead of the bytes, so the browser can
     * fetch the archive itself via GET and stream it to disk. Download targets only.
     */
    prepare: z.boolean().optional(),
}).refine((body) => !body.databases || body.target.kind === "download", {
    message: "Database dumps can only be downloaded, not written to a storage destination",
    path: ["databases"],
});

/** Response for a download, streamed with whatever length is known up front. */
function downloadResponse(download: ArchiveDownload): NextResponse {
    return new NextResponse(Readable.toWeb(download.stream as Readable) as ReadableStream, {
        headers: {
            "Content-Type": download.contentType,
            "Content-Disposition": attachmentDisposition(download.fileName),
            // A tar.gz is produced on the fly, so only a single dump has a known length.
            ...(download.contentLength !== undefined ? { "Content-Length": String(download.contentLength) } : {}),
            "Cache-Control": "no-store",
        },
    });
}

/**
 * Restores selected files out of a backup.
 *
 * A `download` target streams a gzipped tar straight to the client. It is streamed rather
 * than assembled first because a selection can exceed both RAM and free disk on the host,
 * and the user should see bytes moving immediately.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await props.params;

    try {
        const parsed = RestoreFilesSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }
        const { file, selections, databases, target, excludePatterns, dryRun, prepare, profileIdOverride } = parsed.data;

        // A download only reads the backup, so it needs the download permission. Writing
        // files back into a storage destination is a restore and is gated accordingly. A dry run
        // only counts what a pick holds, which the restore page asks for before a restore, so
        // either permission may ask for one.
        if (dryRun) {
            checkAnyPermissionWithContext(ctx, [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD]);
        } else {
            checkPermissionWithContext(
                ctx,
                target.kind === "download" ? PERMISSIONS.STORAGE.DOWNLOAD : PERMISSIONS.STORAGE.RESTORE
            );
        }

        const input: FileRestoreInput = {
            storageConfigId: id, file, selections, databases, excludePatterns, target,
            ...(profileIdOverride ? { keyOverride: { profileId: profileIdOverride } } : {}),
        };

        if (dryRun) {
            return NextResponse.json({ success: true, data: await planFileRestore(input) });
        }

        if (prepare && target.kind === "download") {
            // Resolving the plan here is what makes the handoff safe to hand to the browser:
            // a selection that matches nothing, or a snapshot missing an archive of its
            // chain, fails now - as a message the user can read - instead of halfway into a
            // download the browser has already started writing to disk.
            const { fileName, contentType, ...plan } = await planArchiveDownload(input);
            const token = generateSelectionDownloadToken({
                storageId: id, file, userId: ctx.userId, fileName, contentType,
                selections, databases, excludePatterns, profileIdOverride,
            });

            return NextResponse.json({ success: true, data: { token, fileName, ...plan } });
        }

        if (target.kind === "download") {
            const download = await openArchiveDownload(input);

            await auditService.log(
                ctx.userId, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.DESTINATION,
                { action: "file_restore_download", file, selections, databases }, id
            );

            return downloadResponse(download);
        }

        const result = await restoreFilesToStorage(input);

        await auditService.log(
            ctx.userId, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.DESTINATION,
            { action: "file_restore", file, target: target.kind, restored: result.restored, failed: result.failed.length }, id
        );

        return NextResponse.json({
            success: result.failed.length === 0,
            data: result,
            message: result.failed.length === 0
                ? `Restored ${result.restored} file(s)`
                : `Restored ${result.restored} file(s), ${result.failed.length} failed`,
        });
    } catch (e: unknown) {
        const keyRequired = keyRequiredResponse(e);
        if (keyRequired) return keyRequired;

        log.error("File restore failed", { configId: id }, wrapError(e));
        return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
    }
}

/**
 * Serves a download prepared by POST, for the browser to fetch on its own.
 *
 * This exists so the archive never passes through the page: the browser's download manager
 * writes the response straight to disk and shows its own progress, which is the only way a
 * selection larger than the machine's RAM can be downloaded at all.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const token = req.nextUrl.searchParams.get("token");
        const claim = token ? consumeSelectionDownloadToken(token, ctx.userId) : null;
        if (!claim || claim.storageId !== id) {
            return NextResponse.json(
                { success: false, error: "This download link has expired. Start the download again." },
                { status: 410 }
            );
        }

        const download = await openArchiveDownload({
            storageConfigId: id,
            file: claim.file,
            selections: claim.selection.selections,
            databases: claim.selection.databases,
            excludePatterns: claim.selection.excludePatterns,
            target: { kind: "download" },
            ...(claim.selection.profileIdOverride
                ? { keyOverride: { profileId: claim.selection.profileIdOverride } }
                : {}),
        });

        await auditService.log(
            ctx.userId, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.DESTINATION,
            { action: "file_restore_download", file: claim.file, selections: claim.selection.selections, databases: claim.selection.databases }, id
        );

        // The name the prepare step promised, so the browser saves what the user was shown.
        return downloadResponse({ ...download, fileName: claim.selection.fileName });
    } catch (e: unknown) {
        log.error("Prepared file download failed", { configId: id }, wrapError(e));
        return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
    }
}
