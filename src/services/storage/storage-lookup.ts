import type { StorageAdapter } from "@/lib/core/interfaces";
import { NotFoundError } from "@/lib/logging/errors";
import { openDestination } from "@/services/sharing/destination-access";

const STORAGE = "Storage adapter";

/** A storage destination ready for I/O: its adapter and its config with the credentials in it. */
export interface OpenStorage {
    adapter: StorageAdapter;
    config: unknown;
}

/**
 * Whether an error says the storage destination itself does not exist. A route answers that
 * with 404, while a missing thing further down stays the failure it was.
 */
export function isMissingStorage(error: unknown): boolean {
    return error instanceof NotFoundError && error.resource === STORAGE;
}

/**
 * Opens a storage connection for I/O as the tenant that runs now sees it, see
 * `src/services/sharing/destination-access.ts`. Throws `NotFoundError` for one it may not use.
 */
export async function openStorage(id: string): Promise<OpenStorage> {
    const { adapter, config } = await openDestination(id);
    return { adapter, config };
}
