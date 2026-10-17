/**
 * Reading connections: the list of one kind as the tables and pickers get it, and the one
 * connection a route looks at before it acts on it.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { toAdapterListItem, type AdapterListItemDTO } from "@/lib/adapters/dto";
import type { StorageRole } from "@/lib/core/storage-roles";
import { getConnectionOverview, type ConnectionOverview } from "./connection-overview";
import { listedDatabasesOf, type ListedDatabases } from "./connection-databases";
import { providedItems } from "@/services/sharing/connection-options";
import { connectionShareService } from "@/services/sharing/connection-shares";
import type { SharedServerTerms } from "@/services/sharing/shared-server-rows";

/**
 * A row of the list, with the overview when the caller asked for it. A database connection also
 * carries the databases it held at its last read, and a server of another tenant whose databases
 * the tenant holds, which only the Connections page lists, carries the terms of those databases.
 */
export type AdapterListEntry = AdapterListItemDTO & {
    overview?: ConnectionOverview | null;
    listedDatabases?: ListedDatabases | null;
    sharedServer?: SharedServerTerms;
};

export interface ListAdaptersOptions {
    /** Storage only. Without it both roles come back, which the job form splits itself. */
    role?: StorageRole;
    /** Usage, last backup and health on top, for the connection tables. */
    overview?: boolean;
    /** Who gets each own connection the tenant shares, for whoever may see what is shared. */
    shares?: boolean;
    /**
     * Databases only: the servers of other tenants whose databases the tenant holds now, one row
     * each after its own ones. Only the Connections page asks for them, never a picker or a form,
     * and never in All tenants. `backups` is whether the viewer may see the backups themselves.
     */
    sharedServers?: { tenantId: string; backups: boolean };
}

/** The rows of the provided servers, loaded only when asked for, so the plain list never loads their module. */
async function sharedServerRows(type: string, options: ListAdaptersOptions["sharedServers"]): Promise<AdapterListEntry[]> {
    if (type !== "database" || !options) return [];
    const { sharedServerItems } = await import("@/services/sharing/shared-server-rows");
    return sharedServerItems(options.tenantId, { backups: options.backups });
}

/**
 * The connections of one type, newest first, and after them the destinations and channels other
 * tenants share with the tenant that runs now, marked with who shares them, and when asked for the
 * servers of other tenants whose databases the tenant holds.
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
    const own = adapters.map(toAdapterListItem);
    const shares = options.shares ? await connectionShareService.summaries(own.map((item) => item.id)) : new Map();
    const items = [
        ...own.map((item) => (shares.has(item.id) ? { ...item, share: shares.get(item.id) } : item)),
        ...(await providedItems(type, role)),
    ];
    const shared = await sharedServerRows(type, options.sharedServers);

    // The overview costs several aggregate queries, so only the tables that show it pay for it. A
    // provided server has none, its backups come with its row and its health stays with its provider.
    if (!options.overview) return [...items, ...shared];
    const ids = items.map((item) => item.id);
    const [overview, listed] = await Promise.all([getConnectionOverview(ids), type === "database" ? listedDatabasesOf(ids) : new Map<string, ListedDatabases>()]);
    return [
        ...items.map((item) => ({ ...item, overview: overview.get(item.id) ?? null, ...(type === "database" ? { listedDatabases: listed.get(item.id) ?? null } : {}) })),
        ...shared.map((item) => ({ ...item, overview: null })),
    ];
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
