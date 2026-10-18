import prisma from "@/lib/prisma";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { isBackupFile } from "@/lib/core/backup-files";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { getTenantNotificationConfig, saveTenantNotificationConfig } from "@/services/notifications/tenant-notification-settings";
import { TENANTS_FOLDER } from "@/lib/tenant/storage-view";
import type { Tx } from "@/lib/prisma-tx";
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
    let backups = 0;
    for (const file of files) {
        await adapter.delete(config, file.path);
        if (isBackupFile(file.name)) backups++;
    }
    await runAsTenant(tenantId, () => Promise.all([
        prisma.storageListCache.deleteMany({ where: { adapterConfigId: configId, tenantId } }),
        prisma.storageSnapshot.deleteMany({ where: { adapterConfigId: configId, tenantId } }),
    ]));
    log.info("Deleted the backups of a tenant on a shared destination", { configId, tenantId, backups });
    return backups;
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
        return { tenantId, jobs: jobs.map((job) => job.name), templates: [...new Set(channels.map((channel) => channel.template.name))], backups: 0 };
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
        return { tenantId, jobs: links.map((link) => link.job.name), templates: [], backups };
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
    for (const file of files) await adapter.delete(config, file.path);
    if (files.length > 0) log.info("Deleted what was left of the customers on a destination no longer shared", { configId, files: files.length });
    return files.length;
}
