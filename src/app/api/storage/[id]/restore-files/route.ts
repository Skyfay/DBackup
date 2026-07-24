import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { Readable } from "stream";
import path from "path";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { planFileRestore, restoreFilesToStorage, streamFileRestore, FileRestoreInput } from "@/services/restore/file-restore";
import { generateSelectionDownloadToken, consumeSelectionDownloadToken } from "@/lib/auth/download-tokens";
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
    /** Omit to restore the complete snapshot. An entry without paths means that whole source. */
    selections: z.array(z.object({
        src: z.string().min(1),
        paths: z.array(z.string().min(1)).min(1).optional(),
    })).min(1).optional(),
    target: TargetSchema,
    /** Resolve the selection and report its size without restoring anything. */
    dryRun: z.boolean().optional(),
    /**
     * Validate the selection and hand back a token instead of the bytes, so the browser can
     * fetch the archive itself via GET and stream it to disk. Download targets only.
     */
    prepare: z.boolean().optional(),
});

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
        const { file, selections, target, dryRun, prepare } = parsed.data;

        // A download only reads the backup, so it needs the download permission. Writing
        // files back into a storage destination is a restore and is gated accordingly.
        checkPermissionWithContext(
            ctx,
            target.kind === "download" ? PERMISSIONS.STORAGE.DOWNLOAD : PERMISSIONS.STORAGE.RESTORE
        );

        const input: FileRestoreInput = { storageConfigId: id, file, selections, target };

        if (dryRun) {
            return NextResponse.json({ success: true, data: await planFileRestore(input) });
        }

        if (prepare && target.kind === "download") {
            // Resolving the plan here is what makes the handoff safe to hand to the browser:
            // a selection that matches nothing, or a snapshot missing an archive of its
            // chain, fails now - as a message the user can read - instead of halfway into a
            // download the browser has already started writing to disk.
            const plan = await planFileRestore(input);
            const fileName = `${path.basename(file).replace(/\.[^.]+$/, "")}-files.tar.gz`;
            const token = generateSelectionDownloadToken({ storageId: id, file, userId: ctx.userId, fileName, selections });

            return NextResponse.json({ success: true, data: { token, fileName, ...plan } });
        }

        if (target.kind === "download") {
            const archiveName = path.basename(file).replace(/\.[^.]+$/, "");
            const stream = await streamFileRestore(input);

            await auditService.log(
                ctx.userId, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.DESTINATION,
                { action: "file_restore_download", file, selections }, id
            );

            return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
                headers: {
                    "Content-Type": "application/gzip",
                    "Content-Disposition": `attachment; filename="${archiveName}-files.tar.gz"`,
                    // Length is unknown up front because the payload is produced on the fly.
                    "Cache-Control": "no-store",
                },
            });
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

        const stream = await streamFileRestore({
            storageConfigId: id,
            file: claim.file,
            selections: claim.selection.selections,
            target: { kind: "download" },
        });

        await auditService.log(
            ctx.userId, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.DESTINATION,
            { action: "file_restore_download", file: claim.file, selections: claim.selection.selections }, id
        );

        return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
            headers: {
                "Content-Type": "application/gzip",
                "Content-Disposition": `attachment; filename="${claim.selection.fileName}"`,
                // Length is unknown up front because the payload is produced on the fly.
                "Cache-Control": "no-store",
            },
        });
    } catch (e: unknown) {
        log.error("Prepared file download failed", { configId: id }, wrapError(e));
        return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
    }
}
