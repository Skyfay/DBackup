import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage/storage-service";
import { backupAuditDetails, destinationAuditName } from "@/services/storage/backup-audit";
import { auditedProbe } from "@/services/adapters/probe-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { configBackupRefusal } from "@/lib/server/config-backup-guard";

const log = logger.child({ route: "storage/files" });

// Ensure adapters are registered in this route handler environment
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const params = await props.params;
        const url = new URL(req.url);
        const typeFilter = url.searchParams.get("typeFilter") || undefined;
        const bypassCache = url.searchParams.get("refresh") === "true";

        const list = () => storageService.listFilesWithMetadata(params.id, typeFilter, bypassCache);
        if (!bypassCache) return NextResponse.json(await list());

        // A refresh lists the destination live with its saved login, so it gets an entry like Check now,
        // once it ran. A destination the tenant may not use is a refusal and writes none.
        const name = await destinationAuditName(params.id);
        const target = { record: { id: params.id, name }, ...(name ? { names: [name] } : {}) };
        return NextResponse.json(await auditedProbe(ctx, "storage_check", target, list));

    } catch (error: unknown) {
        // A destination the tenant may not use reads like one that does not exist.
        const refused = serviceRefusal(error);
        if (refused) return refused;
        const resolvedParams = await props.params.catch(() => ({ id: "unknown" }));
        log.error("List files error", { storageId: resolvedParams.id }, wrapError(error));
        return NextResponse.json({ error: "The files of the destination could not be listed. The log of DBackup has the details." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DELETE);

        const { path } = await req.json();
        const params = await props.params;

        if (!path) {
            return NextResponse.json({ error: "Path is required" }, { status: 400 });
        }
        // A configuration backup is the platform's, deleting it takes away the copy of every tenant.
        const configBackup = await configBackupRefusal(ctx, params.id, path);
        if (configBackup) return configBackup;

        // Delegate logic to Service
        const success = await storageService.deleteFile(params.id, path);

        if (!success) {
             return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
        }

        await auditService.logFor(ctx, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.BACKUP, { ...(await backupAuditDetails(params.id, path)) }, params.id);

        // Refresh the storage stats of this destination after file deletion (non-blocking)
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache({ configIds: [params.id] }).catch(() => {});
        });

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        // A path that names no file, like the root of the destination, a destination that is gone and a
        // backup later ones of its chain build on are the caller's to fix.
        const refused = serviceRefusal(error);
        if (refused) return refused;
        const resolvedParams = await props.params.catch(() => ({ id: "unknown" }));
        log.error("Delete file error", { storageId: resolvedParams.id }, wrapError(error));
        return NextResponse.json({ error: "The file could not be deleted. The log of DBackup has the details." }, { status: 500 });
    }
}
