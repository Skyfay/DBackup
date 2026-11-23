import { CONFIG_BACKUP_FOLDER_NAME, isConfigBackupFolderName } from "@/lib/core/config-backup-path";
import { JOB_FOLDER_NAME, isUnsafeJobFolderName } from "@/lib/core/job-folder";
import { ValidationError } from "@/lib/logging/errors";
import type { Tx } from "@/lib/prisma-tx";
import { TENANTS_FOLDER, isTenantsFolderName } from "@/lib/tenant/storage-view";

/** What the check reads, the client of DBackup or a transaction, which holds the one connection to SQLite. */
type ShareClient = Pick<Tx, "connectionShare">;

/**
 * Refuses a name a job may not have with these destinations, wherever a job gets its name: a create,
 * an update, a copy and a restore from Recently deleted. A job writes into the folder its name gives
 * on every destination, so it is never called like the folder of the configuration backup on any
 * destination, since that destination can change (`isConfigBackupFolderName`), never with a folder
 * that leaves its own (`isUnsafeJobFolderName`), and never like the folder a shared destination keeps
 * for the customers while one of its destinations is shared by this tenant. Its backups would land
 * among theirs.
 */
export async function assertJobFolderName(client: ShareClient, name: string, configIds: readonly string[]): Promise<void> {
    if (isConfigBackupFolderName(name)) throw new ValidationError(CONFIG_BACKUP_FOLDER_NAME, { field: "name" });
    if (isUnsafeJobFolderName(name)) throw new ValidationError(JOB_FOLDER_NAME, { field: "name" });
    if (!isTenantsFolderName(name) || configIds.length === 0) return;
    const shared = await client.connectionShare.count({ where: { id: { in: [...configIds] } } });
    if (shared > 0) throw new ValidationError(`A job writing to a destination this tenant shares cannot be called ${TENANTS_FOLDER}, that folder holds the backups of its customers.`);
}
