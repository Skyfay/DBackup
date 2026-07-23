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
        const { file, selections, target, dryRun } = parsed.data;

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
