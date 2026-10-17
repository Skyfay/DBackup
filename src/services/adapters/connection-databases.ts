import prisma from "@/lib/prisma";

/**
 * How many databases each database connection held when its databases were last read, from the
 * lists the Database Explorer keeps (`DatabaseListCache`), so the Connections page asks no server.
 * A connection whose databases were never read has none here and shows nothing.
 */

/** The databases a server held at its last read, with the first names of them. */
export interface ListedDatabases {
    count: number;
    /** The first names by the alphabet, enough for the cell of the list. */
    names: string[];
}

/** How many names the list hands out of each server. */
const NAMES_SHOWN = 3;

function namesOf(json: string): string[] | null {
    try {
        const listed: unknown = JSON.parse(json);
        if (!Array.isArray(listed)) return null;
        return listed.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string" ? [(entry as { name: string }).name] : []));
    } catch {
        return null;
    }
}

/** The listed databases of the connections among `ids` whose databases were read at least once. One query. */
export async function listedDatabasesOf(ids: string[]): Promise<Map<string, ListedDatabases>> {
    const result = new Map<string, ListedDatabases>();
    if (ids.length === 0) return result;
    const lists = await prisma.databaseListCache.findMany({
        where: { adapterConfigId: { in: ids }, readAt: { not: null } },
        select: { adapterConfigId: true, databasesJson: true },
    });
    for (const list of lists ?? []) {
        const names = namesOf(list.databasesJson);
        if (!names) continue;
        result.set(list.adapterConfigId, { count: names.length, names: [...names].sort((a, b) => a.localeCompare(b)).slice(0, NAMES_SHOWN) });
    }
    return result;
}
