import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import type { StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

registerAdapters();

const STORAGE = "Storage adapter";

/** A storage destination ready for I/O: its adapter and its config with the credentials in it. */
export interface OpenStorage {
    adapter: StorageAdapter;
    config: unknown;
}

/** The row of a storage destination. Throws `NotFoundError` when no storage has this id. */
export async function findStorageConfig(id: string): Promise<AdapterConfig> {
    const row = await prisma.adapterConfig.findUnique({ where: { id } });
    if (!row || row.type !== "storage") throw new NotFoundError(STORAGE, id);
    return row;
}

/**
 * Whether an error says the storage destination itself does not exist. A route answers that
 * with 404, while a missing thing further down stays the failure it was.
 */
export function isMissingStorage(error: unknown): boolean {
    return error instanceof NotFoundError && error.resource === STORAGE;
}

/** Opens a storage destination for reading. Throws `NotFoundError` when no storage has this id. */
export async function openStorage(id: string): Promise<OpenStorage> {
    const row = await findStorageConfig(id);
    const adapter = registry.get(row.adapterId) as StorageAdapter;
    if (!adapter) throw new ServiceError("StorageLookup", "open", "Storage impl missing");
    return { adapter, config: await resolveAdapterConfig(row) };
}
