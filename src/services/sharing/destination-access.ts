import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import type { AdapterConfig as ResolvedConfig, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runAsSystem } from "@/lib/tenant/context";
import { currentTenantId } from "@/lib/tenant/current";
import { SHARED_STORAGE_FAILURE, innerPath, storageView, type StorageViewMode } from "@/lib/tenant/storage-view";
import { providedConnection, type ProvidedConnection } from "./provided";

const log = logger.child({ service: "DestinationAccess" });

/**
 * Opens a storage connection as the tenant that runs now sees it: its own destination as it is, or
 * without the folder of its customers once it shares it, and a destination another tenant shares
 * with it as its own folder there. Everything that reads or writes the backups of a destination
 * goes through here, so a customer never reaches a file of another tenant by a path it sends.
 */

const STORAGE = "Storage adapter";

/** A storage connection ready for I/O as one tenant sees it. */
export interface OpenDestination {
    row: AdapterConfig;
    adapter: StorageAdapter;
    config: ResolvedConfig;
    mode: StorageViewMode;
    /** The tenant whose view it is. */
    tenantId: string;
}

/** Whether the tenant of a connection shares it with other tenants. */
export async function isShared(configId: string): Promise<boolean> {
    return (await runAsSystem(() => prisma.connectionShare.count({ where: { id: configId } }))) > 0;
}

/**
 * How `tenantId` sees a destination, with what its tenant asks of it when another tenant shares it.
 * The mode is null for a destination of another tenant that is not shared with this one.
 */
export async function destinationAccess(row: { id: string; tenantId: string }, tenantId: string): Promise<{ mode: StorageViewMode | null; provided: ProvidedConnection | null }> {
    if (row.tenantId === tenantId) return { mode: (await isShared(row.id)) ? { kind: "provider" } : { kind: "own" }, provided: null };
    const provided = await providedConnection(row.id, tenantId);
    return { mode: provided ? { kind: "customer", tenantId } : null, provided };
}

/** How `tenantId` sees a destination, or null when it is another tenant's and not shared with it. */
export async function viewModeOf(row: { id: string; tenantId: string }, tenantId: string): Promise<StorageViewMode | null> {
    return (await destinationAccess(row, tenantId)).mode;
}

/**
 * Whose view a call takes: the tenant given, else the one that runs now, else the tenant of the
 * destination, for the system scope and All tenants, which see a destination as its tenant does.
 */
export async function viewerOf(row: { tenantId: string }, tenantId?: string | null): Promise<string> {
    return tenantId ?? (await currentTenantId()) ?? row.tenantId;
}

/** The row of a storage connection a tenant may use, with its view. Throws a NotFoundError otherwise. */
export async function findDestination(id: string, tenantId?: string | null): Promise<{ row: AdapterConfig; mode: StorageViewMode; tenantId: string }> {
    const row = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id } }));
    if (!row || row.type !== "storage") throw new NotFoundError(STORAGE, id);
    const viewer = await viewerOf(row, tenantId);
    const mode = await viewModeOf(row, viewer);
    if (!mode) throw new NotFoundError(STORAGE, id);
    return { row, mode, tenantId: viewer };
}

/**
 * The row of a storage connection a tenant may use, once a path on it is one its view reaches, like
 * the archive of a restore or of a link. Throws a NotFoundError for a destination it may not use and
 * a ValidationError for a path outside its view, like the folder of the customers for the tenant
 * that shares the destination. Reads nothing of the storage, so a caller refuses before anything
 * else happens, like a database the restore creates or an entry in the audit log.
 */
export async function findDestinationPath(id: string, remotePath: string, tenantId?: string | null): Promise<{ row: AdapterConfig; mode: StorageViewMode; tenantId: string }> {
    const found = await findDestination(id, tenantId);
    innerPath(found.mode, remotePath);
    return found;
}

/**
 * The adapter of a row as a mode sees it, with the credentials in its config. A customer never reads
 * why the settings of a destination another tenant shares could not be used, since the message names
 * its logins and options, see `SHARED_STORAGE_FAILURE`.
 */
export async function openRow(row: AdapterConfig, mode: StorageViewMode): Promise<{ adapter: StorageAdapter; config: ResolvedConfig }> {
    try {
        // The adapters register on the first use, wherever this module is loaded from.
        if (!registry.get(row.adapterId)) registerAdapters();
        const adapter = registry.get(row.adapterId) as StorageAdapter | undefined;
        if (!adapter) throw new NotFoundError("Storage adapter implementation", row.adapterId);
        return { adapter: storageView(adapter, mode), config: (await resolveAdapterConfig(row)) as ResolvedConfig };
    } catch (error: unknown) {
        if (mode.kind !== "customer") throw error;
        log.warn("The settings of a destination shared with a tenant could not be used", { configId: row.id, tenantId: mode.tenantId }, wrapError(error));
        throw new Error(SHARED_STORAGE_FAILURE);
    }
}

/** Opens a storage connection a tenant may use. Throws a NotFoundError for one it may not. */
export async function openDestination(id: string, tenantId?: string | null): Promise<OpenDestination> {
    const found = await findDestination(id, tenantId);
    return { ...found, ...(await openRow(found.row, found.mode)) };
}
