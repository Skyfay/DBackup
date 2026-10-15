"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { prepareSharedDownload, restoreSharedBackup, sharedOverview, type SharedOverview } from "@/services/tenant/shared-databases";
import { requestSharedBackup, sharedBackupRun, type SharedRunStatus } from "@/services/tenant/shared-on-demand";

/**
 * The databases another tenant's shared server holds for the viewer's tenant, the tab Shared with
 * you of the Backups page: their backups, the download of one dump, the restore into the same
 * database and a backup of it on demand. The rights are the ones of the Backups page in the
 * viewer's own tenant, and of Run now of a job for a backup on demand.
 */

const log = logger.child({ action: "shared-databases" });

const RefSchema = z.object({
    sourceId: z.string().min(1).max(200),
    databaseName: z.string().min(1).max(200),
    backupId: z.string().regex(/^[a-f0-9]{32}$/, "Invalid backup"),
});

/** A backup that is not the viewer's reads the same as one that does not exist. */
const GONE = "This backup is not there any more.";

export async function getSharedOverview(): Promise<{ success: true; data: SharedOverview } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.STORAGE.READ);
    if (!viewer.tenantId) return { success: false, error: "Open a tenant to see what is shared with it." };
    try {
        return { success: true, data: await sharedOverview(viewer.tenantId) };
    } catch (error: unknown) {
        log.error("Reading the shared databases failed", { tenantId: viewer.tenantId }, wrapError(error));
        return { success: false, error: "The shared databases could not be loaded." };
    }
}

/** Pulls the dump of the database out of a backup, for the browser to collect with the token. */
export async function downloadSharedBackup(input: z.input<typeof RefSchema>) {
    const viewer = await checkPermission(PERMISSIONS.STORAGE.DOWNLOAD);
    const parsed = RefSchema.safeParse(input);
    if (!viewer.tenantId || !parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const prepared = await prepareSharedDownload(viewer.tenantId, viewer.id, parsed.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.BACKUP, {
            action: "download", shared: true, name: parsed.data.databaseName, file: prepared.fileName, databases: [parsed.data.databaseName],
        });
        return { success: true as const, data: { url: `/api/storage/${prepared.storageId}/download?token=${prepared.token}`, fileName: prepared.fileName } };
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return { success: false as const, error: GONE };
        log.error("Preparing a shared download failed", { sourceId: parsed.data.sourceId }, wrapError(error));
        return { success: false as const, error: "The backup could not be downloaded." };
    }
}

/** Restores the database out of a backup into itself on its server. */
export async function restoreSharedDatabase(input: z.input<typeof RefSchema>) {
    const viewer = await checkPermission(PERMISSIONS.STORAGE.RESTORE);
    const parsed = RefSchema.safeParse(input);
    if (!viewer.tenantId || !parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const { executionId, target } = await restoreSharedBackup(viewer.tenantId, parsed.data, viewer.name);
        await auditService.log(viewer.id, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.BACKUP, {
            shared: true, name: parsed.data.databaseName, databases: [parsed.data.databaseName], executionId,
            // A backup of a database that moved since goes into it at its new place.
            ...(target.databaseName !== parsed.data.databaseName ? { target: target.databaseName } : {}),
        });
        return { success: true as const, data: { executionId } };
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return { success: false as const, error: GONE };
        if (error instanceof ValidationError) return { success: false as const, error: error.message };
        log.error("Starting a shared restore failed", { sourceId: parsed.data.sourceId }, wrapError(error));
        return { success: false as const, error: "The restore could not be started." };
    }
}

const PlaceSchema = z.object({
    sourceId: z.string().min(1).max(200),
    databaseName: z.string().min(1).max(200),
});

/**
 * Starts a backup of a database given to the viewer's tenant, where its provider allows backups on
 * demand. The run belongs to the provider, so both audit logs keep it: the customer's names the
 * database, the provider's the job and who asked.
 */
export async function backUpSharedDatabase(input: z.input<typeof PlaceSchema>) {
    const viewer = await checkPermission(PERMISSIONS.JOBS.EXECUTE);
    const parsed = PlaceSchema.safeParse(input);
    if (!viewer.tenantId || !parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const started = await requestSharedBackup(viewer.tenantId, { id: viewer.id, name: viewer.name }, parsed.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.BACKUP, {
            action: "backup_on_demand", shared: true, name: started.databaseName, databases: [started.databaseName],
        });
        await auditService.log(viewer.id, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.JOB, {
            action: "backup_on_demand", name: started.jobName, database: started.databaseName, tenant: started.customerName, executionId: started.executionId,
        }, started.jobId, { tenantId: started.serverTenantId });
        return { success: true as const, data: { requestId: started.requestId } };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false as const, error: error.message };
        log.error("Starting a shared backup failed", { sourceId: parsed.data.sourceId }, wrapError(error));
        return { success: false as const, error: "The backup could not be started." };
    }
}

/** Where a backup the viewer's tenant started stands: queued, running, done or failed, nothing else of the run. */
export async function getSharedBackupRun(requestId: string): Promise<{ success: true; data: SharedRunStatus } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.STORAGE.READ);
    const id = z.string().min(1).max(200).safeParse(requestId);
    if (!viewer.tenantId || !id.success) return { success: false, error: "Invalid request" };
    try {
        return { success: true, data: await sharedBackupRun(viewer.tenantId, id.data) };
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return { success: false, error: "This backup is not there any more." };
        log.error("Reading a shared backup run failed", { requestId: id.data }, wrapError(error));
        return { success: false, error: "The state of the backup could not be read." };
    }
}
