import { ownDataRefusal } from "@/lib/adapters/own-data";
import { tenantFolder } from "@/lib/tenant/storage-view";

/**
 * Why a run writes nothing into a destination, its folder or the folder of the job below it, since
 * one of them reaches the own data of DBackup, or null. `folder` is the path of the job below the
 * destination, like its name, or its name and the folder of an incremental chain. The destination of
 * the configuration backup writes into the folder of its files, but the folder of a job never does,
 * also not through a link into it.
 *
 * A customer of a shared destination writes into `tenants/<its id>/` there, see `storageView`, so
 * for a run of a customer (`customer`, the id of its tenant) the folder of its job lies below that
 * one, and the check looks at the folder the files really land in.
 */
export async function jobFolderRefusal(adapterId: string, config: Record<string, unknown>, configId: string, folder: string, customer?: string): Promise<string | null> {
    const subPath = customer ? `${tenantFolder(customer)}/${folder}` : folder;
    return (await ownDataRefusal(adapterId, config, { configId }))
        ?? (await ownDataRefusal(adapterId, config, { subPath }));
}
