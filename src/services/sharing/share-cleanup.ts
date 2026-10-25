import prisma from "@/lib/prisma";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { isBackupFile } from "@/lib/core/backup-files";
import { logger } from "@/lib/logging/logger";
import { ServiceError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { getTenantNotificationConfig, saveTenantNotificationConfig } from "@/services/notifications/tenant-notification-settings";
import { TENANTS_FOLDER } from "@/lib/tenant/storage-view";
import type { Tx } from "@/lib/prisma-tx";
import type { AdapterConfig as ResolvedConfig, FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { openRow } from "./destination-access";
import type { SharedKind } from "./provided";

const log = logger.child({ service: "ShareCleanup" });

/**
 * What a tenant loses with a connection another tenant stops sharing with it: every link of its own
 * to the connection, so nothing of it points at a connection it no longer sees, and on a destination
 * its backups there. Everything here runs in the system scope, since the connection belongs to
 * another tenant than the links.
 */

/** The backups of a tenant on a shared destination, deleted from the storage. Returns how many backups went. */
export async function deleteTenantBackups(configId: string, tenantId: string): Promise<number> {
    const row = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id: configId } }));
    if (!row) return 0;
    // The view of the customer, so not a byte outside its folder is touched.
    const { adapter, config } = await openRow(row, { kind: "customer", tenantId });
    const files = await adapter.list(config, "");
    await deleteFiles(adapter, config, files, "");
    const backups = files.filter((file) => isBackupFile(file.name)).length;
    // The root of the customer's view is its folder, `tenants/<id>/`, which goes too once empty.
    await removeEmptyFolders(adapter, config, files, "", configId);
    await runAsTenant(tenantId, () => Promise.all([
        prisma.storageListCache.deleteMany({ where: { adapterConfigId: configId, tenantId } }),
        prisma.storageSnapshot.deleteMany({ where: { adapterConfigId: configId, tenantId } }),
    ]));
    log.info("Deleted the backups of a tenant on a shared destination", { configId, tenantId, backups });
    return backups;
}

/**
 * Deletes every file and throws when the storage kept one. Most storage adapters answer a delete
 * they could not do with false instead of throwing, so a file whose delete answered false counts as
 * kept while a second listing of `dir` still shows it. One that went in between, like by the
 * retention of a run, counts as deleted.
 */
async function deleteFiles(adapter: StorageAdapter, config: ResolvedConfig, files: readonly FileInfo[], dir: string): Promise<void> {
    const refused: string[] = [];
    for (const file of files) {
        if (!(await adapter.delete(config, file.path))) refused.push(file.path);
    }
    if (refused.length === 0) return;
    const left = new Set((await adapter.list(config, dir)).map((file) => file.path));
    const kept = refused.filter((file) => left.has(file)).length;
    if (kept > 0) throw new ServiceError("ShareCleanup", "delete", `The storage refused to delete ${kept} ${kept === 1 ? "file" : "files"}.`);
}

/** Every folder the files lay in, the deepest first, so a folder comes after the folders inside it. */
export function foldersOf(files: readonly Pick<FileInfo, "path">[]): string[] {
    const folders = new Set<string>();
    for (const file of files) {
        const parts = file.path.split("/").filter((part) => part !== "");
        for (let depth = parts.length - 1; depth > 0; depth--) folders.add(parts.slice(0, depth).join("/"));
    }
    return [...folders].sort((a, b) => b.split("/").length - a.split("/").length);
}

/**
 * Removes the folders the deleted files lay in once they are empty, then `root`, where the adapter
 * deletes an empty folder. A storage of objects has no folders to leave behind, and an adapter
 * without `deleteEmptyFolder` leaves them where they are. A folder that still holds something
 * stays, and a failure never stops the caller, since its files are gone already.
 */
async function removeEmptyFolders(adapter: StorageAdapter, config: ResolvedConfig, files: readonly FileInfo[], root: string, configId: string): Promise<void> {
    const remove = adapter.deleteEmptyFolder?.bind(adapter);
    if (!remove || files.length === 0) return;
    const folders = foldersOf(files);
    try {
        for (const folder of folders) await remove(config, folder);
        if (!folders.includes(root)) await remove(config, root);
    } catch (error: unknown) {
        log.warn("The empty folders of the customers could not be removed", { configId }, wrapError(error));
    }
}

/** What one tenant loses, which the audit entry in its log names. */
export interface TenantLoss {
    tenantId: string;
    /** The jobs that no longer write to the destination, or no longer tell the channel. */
    jobs: string[];
    /** The notification templates the channel left. */
    templates: string[];
    /** The backups deleted on the destination. */
    backups: number;
    /**
     * Whether the tenant used the connection at all: a job, a template, a notification setting or
     * recipients of a channel, a job or a backup on a destination.
     */
    used: boolean;
}

/**
 * Takes every link of one tenant to a channel away: its templates, its own notifications and its
 * recipients. With `tx` it writes in that transaction, else in one of its own.
 */
async function forgetChannel(configId: string, tenantId: string, tx?: Tx): Promise<TenantLoss> {
    return runAsSystem(async () => {
        const client = tx ?? prisma;
        // One after the other, which a transaction needs.
        const channels = await client.notificationTemplateChannel.findMany({ where: { configId, template: { tenantId } }, select: { id: true, template: { select: { name: true } } } });
        const jobs = await client.job.findMany({ where: { tenantId, notifications: { some: { id: configId } } }, select: { id: true, name: true } });
        const recipients = await client.channelRecipients.count({ where: { configId, tenantId } });
        const unlink = (db: typeof prisma | Tx) => [
            db.notificationTemplateChannel.deleteMany({ where: { id: { in: channels.map((channel) => channel.id) } } }),
            ...jobs.map((job) => db.job.update({ where: { id: job.id }, data: { notifications: { disconnect: { id: configId } } } })),
            db.channelRecipients.deleteMany({ where: { configId, tenantId } }),
        ];
        if (tx) {
            // A query of Prisma runs once it is awaited, so these run one after the other in the transaction.
            for (const write of unlink(tx)) await write;
        } else {
            await prisma.$transaction(unlink(prisma));
        }
        const settings = await getTenantNotificationConfig(tenantId, client);
        const keep = (list: string[]) => list.filter((id) => id !== configId);
        // An event left without a channel goes to the default channels again instead of nowhere.
        const keepOrDefault = (list: string[]) => (keep(list).length > 0 ? keep(list) : null);
        const named = settings.globalChannels.includes(configId) || Object.values(settings.events).some((event) => event.channels?.includes(configId));
        if (named) {
            await saveTenantNotificationConfig(tenantId, {
                globalChannels: keep(settings.globalChannels),
                events: Object.fromEntries(Object.entries(settings.events).map(([id, event]) => [id, { ...event, channels: event.channels ? keepOrDefault(event.channels) : null }])),
            }, client);
        }
        const used = channels.length > 0 || jobs.length > 0 || recipients > 0 || named;
        return { tenantId, jobs: jobs.map((job) => job.name), templates: [...new Set(channels.map((channel) => channel.template.name))], backups: 0, used };
    });
}

/**
 * Takes every link of one tenant to a destination away and deletes its backups there. The backups
 * go first: when the storage does not answer, nothing changes and the share stays as it was. With
 * `tx` the links go in that transaction.
 */
async function forgetDestination(configId: string, tenantId: string, deleteBackups: boolean, tx?: Tx): Promise<TenantLoss> {
    const backups = deleteBackups ? await deleteTenantBackups(configId, tenantId) : 0;
    return runAsSystem(async () => {
        const client = tx ?? prisma;
        const links = await client.jobDestination.findMany({ where: { configId, job: { tenantId } }, select: { id: true, job: { select: { name: true } } } });
        await client.jobDestination.deleteMany({ where: { id: { in: links.map((link) => link.id) } } });
        await client.storageListCache.deleteMany({ where: { adapterConfigId: configId, tenantId } });
        return { tenantId, jobs: links.map((link) => link.job.name), templates: [], backups, used: links.length > 0 || backups > 0 };
    });
}

/**
 * Taking a connection away stopped at one tenant. The tenants before it lost everything already,
 * which `losses` names, so the caller takes them off the share and logs it.
 */
export class PartialLossError extends Error {
    constructor(readonly losses: TenantLoss[], readonly failedTenantId: string, cause: unknown) {
        super(`Could not take it away from a tenant: ${getErrorMessage(cause)}`);
        this.name = "PartialLossError";
    }
}

/**
 * Everything `tenantIds` lose with the connection, one tenant after the other. A destination
 * deletes their backups on it unless `deleteBackups` is false, which only the delete of the tenant
 * that shares it passes, since its connection goes and the storage stays where it is. That delete
 * passes its transaction as `tx` too, so its customers keep every link when it fails. A failure
 * throws `PartialLossError` with what the tenants before lost.
 */
export async function forgetConnection(configId: string, kind: SharedKind, tenantIds: readonly string[], deleteBackups = true, tx?: Tx): Promise<TenantLoss[]> {
    const losses: TenantLoss[] = [];
    for (const tenantId of tenantIds) {
        try {
            losses.push(kind === "channel" ? await forgetChannel(configId, tenantId, tx) : await forgetDestination(configId, tenantId, deleteBackups, tx));
        } catch (error) {
            log.error("Could not take a shared connection away from a tenant", { configId, tenantId }, wrapError(error));
            throw new PartialLossError(losses, tenantId, error);
        }
    }
    return losses;
}

/**
 * How many files lie in the folder of the customers of a destination, as its own tenant sees all of
 * it. Before the first share it must be empty, or the files of the tenant there would show up as the
 * backups of a customer whose id names their folder.
 */
export async function customerFolderFiles(configId: string): Promise<number> {
    const row = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id: configId } }));
    if (!row) return 0;
    const { adapter, config } = await openRow(row, { kind: "own" });
    return (await adapter.list(config, TENANTS_FOLDER)).length;
}

/**
 * Deletes what is left in the folder of the customers of a destination nobody gets any more, like
 * the backups of a deleted tenant the storage did not take at the time. Its own tenant sees the
 * whole destination again from now on, so nothing of a customer may stay. Returns how many files went.
 */
export async function sweepCustomerFolder(configId: string): Promise<number> {
    const row = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id: configId } }));
    if (!row) return 0;
    const { adapter, config } = await openRow(row, { kind: "own" });
    const files = await adapter.list(config, TENANTS_FOLDER);
    await deleteFiles(adapter, config, files, TENANTS_FOLDER);
    // The folder of every customer and `tenants/` itself, which the tenant sees again from now on.
    await removeEmptyFolders(adapter, config, files, TENANTS_FOLDER, configId);
    if (files.length > 0) log.info("Deleted what was left of the customers on a destination no longer shared", { configId, files: files.length });
    return files.length;
}
