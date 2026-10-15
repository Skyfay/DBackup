/**
 * Reading connections: the list of one kind as the tables and pickers get it, and the one
 * connection a route looks at before it acts on it.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { toAdapterListItem, type AdapterListItemDTO } from "@/lib/adapters/dto";
import type { StorageRole } from "@/lib/core/storage-roles";
import { getConnectionOverview, type ConnectionOverview } from "./connection-overview";

/** A row of the list, with the overview when the caller asked for it. */
export type AdapterListEntry = AdapterListItemDTO & { overview?: ConnectionOverview | null };

export interface ListAdaptersOptions {
    /** Storage only. Without it both roles come back, which the job form splits itself. */
    role?: StorageRole;
    /** Usage, last backup and health on top, for the connection tables. */
    overview?: boolean;
}

/**
 * The connections of one type, newest first.
 *
 * Every row goes through the safe DTO, which deletes the secrets rather than blanking them and
 * reports which are set, so a decrypted secret never leaves here whatever the caller may see.
 */
export async function listAdapters(type: string, options: ListAdaptersOptions = {}): Promise<AdapterListEntry[]> {
    const { role } = options;
    const adapters = await prisma.adapterConfig.findMany({
        where: {
            type,
            ...(role && type === "storage" ? { storageRole: role } : {}),
        },
        orderBy: { createdAt: "desc" },
    });
    const items = adapters.map(toAdapterListItem);

    // The overview costs several aggregate queries, so only the tables that show it pay for it.
    if (!options.overview) return items;
    const overview = await getConnectionOverview(items.map((item) => item.id));
    return items.map((item) => ({ ...item, overview: overview.get(item.id) ?? null }));
}

/** The type of a connection, which decides the permission a route checks. Null when it does not exist. */
export async function getAdapterType(id: string): Promise<string | null> {
    const adapter = await prisma.adapterConfig.findUnique({ where: { id }, select: { type: true } });
    return adapter?.type ?? null;
}

/** A saved connection of this type, or null when the id names none or one of another type. */
export async function getSavedConnection(id: string, type: string): Promise<AdapterConfig | null> {
    const adapter = await prisma.adapterConfig.findUnique({ where: { id } });
    return adapter && adapter.type === type ? adapter : null;
}
