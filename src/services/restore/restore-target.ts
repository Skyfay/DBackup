/**
 * The storage a restore writes files into, found the way every destination is, see
 * `destination-access.ts`. A destination another tenant shares that takes only encrypted backups
 * takes no restored files either: they would land on it in plain text, which is what its tenant
 * ruled out. It reads as one that does not exist, like a destination nobody shares. A restore of
 * files also writes into a directory source, back where they came from or into another folder of
 * it, so this lookup takes both roles where every other lookup of a destination takes destinations
 * alone.
 */

import type { AdapterConfig } from "@prisma/client";
import { NotFoundError } from "@/lib/logging/errors";
import type { StorageViewMode } from "@/lib/tenant/storage-view";
import { ANY_STORAGE_ROLE, destinationAccess, findDestination } from "@/services/sharing/destination-access";

/** The row and view of a storage a restore may write files into. Throws a NotFoundError otherwise. */
export async function findRestoreTarget(id: string): Promise<{ row: AdapterConfig; mode: StorageViewMode; tenantId: string }> {
    const found = await findDestination(id, undefined, { roles: ANY_STORAGE_ROLE });
    if (found.mode.kind === "customer") {
        const { provided } = await destinationAccess(found.row, found.tenantId);
        // The same answer as a storage the tenant may not use, see `findDestination`.
        if (!provided || provided.encryptedOnly) throw new NotFoundError("Storage adapter", id);
    }
    return found;
}
