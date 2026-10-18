import { canOfferCounterpart, counterpartStorageRole, STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import type { TenantAllowances } from "@/lib/tenant/allowances";
import { isProvidedRow } from "./connection-status-filter";
import type { AdapterConfig } from "./types";

/**
 * Whether a row of the Connections page can be picked for a bulk action. A connection another
 * tenant shares and a server of another tenant are changed by that tenant alone, so a switch of
 * many rows would find neither.
 */
export function selectableForBulk(config: AdapterConfig): boolean {
    return !isProvidedRow(config);
}

/**
 * The role Create as directory source or destination gives the copy of a storage connection, or
 * null when it offers none: the adapter works one way round only, or the platform does not let the
 * tenant add that kind itself, whatever it may add of the kind it looks at.
 */
export function counterpartRole(config: AdapterConfig, mayAdd: Pick<TenantAllowances, "directorySources" | "destinations">): StorageRole | null {
    const current = config.storageRole ?? STORAGE_ROLES.DESTINATION;
    if (!canOfferCounterpart(getAdapterDefinition(config.adapterId)?.supportedRoles, current)) return null;
    const counterpart = counterpartStorageRole(current);
    return (counterpart === STORAGE_ROLES.SOURCE ? mayAdd.directorySources : mayAdd.destinations) ? counterpart : null;
}
