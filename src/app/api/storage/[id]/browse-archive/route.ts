import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import prisma from "@/lib/prisma";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "storage/browse-archive" });

const BrowseSchema = z.object({
    /** Remote path of the backup archive, without any sidecar suffix. */
    file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    /** JobSource id of the directory source to browse. Omit to list the sources themselves. */
    jobSourceId: z.string().min(1).optional(),
    /** Directory to list, relative to that source's root. Omit for the root. */
    prefix: z.string().optional(),
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
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const parsed = BrowseSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }
        const { file, jobSourceId, prefix } = parsed.data;

        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id } });
        if (!storageConfig || storageConfig.type !== "storage") {
            return NextResponse.json({ success: false, error: "Storage adapter not found" }, { status: 404 });
        }

        const adapter = registry.get(storageConfig.adapterId) as StorageAdapter | undefined;
        if (!adapter?.read) {
            return NextResponse.json({ success: false, error: "This storage adapter cannot read backup metadata" }, { status: 400 });
        }

        const resolved = await resolveAdapterConfig(storageConfig);
        const metaContent = await adapter.read(resolved, `${file}.meta.json`);
        if (!metaContent) {
            return NextResponse.json({ success: false, error: "Backup metadata not found" }, { status: 404 });
        }

        const meta = JSON.parse(metaContent) as BackupMetadata;
        if (meta.archive?.formatVersion !== 2) {
            return NextResponse.json(
                { success: false, error: "This backup cannot be browsed. Only backups with directory sources created by a recent version carry a file index." },
                { status: 400 }
            );
        }

        // No source selected yet - list the directory sources to pick from.
        if (!jobSourceId) {
            const summary = await archiveIndexService.summarize(id, file, meta);
            if (!summary) {
                return NextResponse.json({ success: false, error: "Could not read the backup's file index" }, { status: 502 });
            }
            return NextResponse.json({ success: true, data: { sources: summary.directories, entries: [] } });
        }

        const entries = await archiveIndexService.browse(id, file, meta, jobSourceId, prefix);
        if (!entries) {
            return NextResponse.json({ success: false, error: "Could not read the backup's file index" }, { status: 502 });
        }

        return NextResponse.json({ success: true, data: { sources: [], entries } });
    } catch (e: unknown) {
        log.error("Failed to browse archive", { configId: id }, wrapError(e));
        return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
    }
}
