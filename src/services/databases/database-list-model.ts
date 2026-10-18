import type {
    DatabaseFacets, DatabaseSort, DatabaseState, DatabaseSummary, ExplorerDatabase, ExplorerServer, ServerBrief,
} from "./database-explorer-types";

/**
 * The rules of the list of the Databases tab as plain functions, for the server that pages it and
 * the page that shows it: the states of a database, the numbers above the list, and the search,
 * the filters with their counts, the order and the page. Kept free of Prisma so the browser can
 * import them and a test can read them alone.
 */

export function statesOf(database: ExplorerDatabase, server: Pick<ExplorerServer, "readAt" | "readError"> | undefined, coverage: boolean): DatabaseState[] {
    const states: DatabaseState[] = [];
    if (coverage) {
        states.push(database.jobIds.length > 0 ? "backed-up" : "no-job");
        if (database.jobIds.length > 0 && !database.lastBackup) states.push("never");
    }
    if (server && (server.readError || !server.readAt)) states.push("unread");
    return states;
}

export function summarize({ databases, servers }: { databases: ExplorerDatabase[]; servers: readonly unknown[] }): DatabaseSummary {
    const noJob = databases.filter((database) => database.jobIds.length === 0);
    const sized = databases.filter((database) => database.sizeInBytes !== null);
    return {
        databases: databases.length,
        servers: servers.length,
        size: sized.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0),
        unsized: databases.length - sized.length,
        // The keys of an instance are no tables.
        tables: databases.reduce((sum, database) => sum + (database.kind === "database" ? database.tableCount ?? 0 : 0), 0),
        backedUp: databases.length - noJob.length,
        noJob: noJob.length,
        noJobSize: noJob.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0),
        biggest: sized.reduce<ExplorerDatabase | null>((best, database) => ((database.sizeInBytes ?? 0) > (best?.sizeInBytes ?? -1) ? database : best), null),
    };
}

/** How old the lists are: the oldest read, and the servers whose latest read failed or never happened. */
export function freshnessOf<T extends Pick<ExplorerServer, "readAt" | "readError">>(servers: T[]) {
    const behind = servers.filter((server) => server.readError !== null || !server.readAt);
    const times = servers.map((server) => server.readAt).filter((value): value is string => value !== null);
    const oldest = times.length === 0 ? null : times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first));
    return { behind, oldest };
}

export interface DatabaseQuery {
    /** From 1. */
    page?: number;
    pageSize?: number;
    sort?: DatabaseSort;
    /** Whether the biggest, the latest or the last name comes first. The biggest first by default. */
    desc?: boolean;
    /** Part of the name of the database, in any case. */
    search?: string;
    serverIds?: string[];
    /** The adapters of the servers, like `postgres`. */
    engines?: string[];
    /** The ids of the jobs that back them up, `none` for the databases in no job. */
    jobIds?: string[];
    states?: string[];
    /** The tenants of the Tenant filter of All tenants. */
    tenantIds?: string[];
}

export const DATABASE_MAX_PAGE_SIZE = 1000;

type Dimension = "server" | "engine" | "job" | "state" | "tenant";

interface Entry {
    database: ExplorerDatabase;
    /** Its place in the list as the servers name them, which breaks a tie in any order. */
    index: number;
    name: string;
    serverName: string;
    engine: string;
    jobs: string[];
    states: DatabaseState[];
}

const clean = (values: string[] | undefined) => (values ?? []).map((value) => value.trim()).filter(Boolean);

/** The names in the order of the table: by their letters whatever the case, with numbers by their value. */
const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** What a sort compares of two entries, ascending. A database without a size or tables comes before any that has one. */
const COMPARE: Record<DatabaseSort, (a: Entry, b: Entry) => number> = {
    size: (a, b) => (a.database.sizeInBytes ?? -1) - (b.database.sizeInBytes ?? -1),
    tables: (a, b) => (a.database.tableCount ?? -1) - (b.database.tableCount ?? -1),
    last: (a, b) => (a.database.lastBackup ? Date.parse(a.database.lastBackup.at) : 0) - (b.database.lastBackup ? Date.parse(b.database.lastBackup.at) : 0),
    database: (a, b) => byName.compare(a.name, b.name),
    server: (a, b) => byName.compare(a.serverName, b.serverName),
};

function tally(counts: Record<string, number>, values: readonly string[]) {
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
}

/**
 * One page of the databases with the search, the filters and the order, and how many each value of
 * a filter leaves under the others. A database counts once for each of its jobs and states, like
 * the faceted filters of a table count them. Ties keep the order the servers list them in.
 */
export function pageOfDatabases(databases: ExplorerDatabase[], servers: ServerBrief[], coverage: boolean, query: DatabaseQuery, byTenant = false): { rows: ExplorerDatabase[]; total: number; facets: DatabaseFacets } {
    const serversById = new Map(servers.map((server) => [server.id, server]));
    const entries: Entry[] = databases.map((database, index) => {
        const server = serversById.get(database.serverId);
        return {
            database,
            index,
            name: database.name,
            serverName: server?.name ?? "",
            engine: server?.adapterId ?? "",
            jobs: database.jobIds.length > 0 ? database.jobIds : ["none"],
            states: statesOf(database, server, coverage),
        };
    });

    const search = query.search?.trim().toLowerCase() ?? "";
    const picked: Record<Dimension, Set<string>> = {
        server: new Set(clean(query.serverIds)),
        engine: new Set(clean(query.engines)),
        job: new Set(coverage ? clean(query.jobIds) : []),
        state: new Set(clean(query.states)),
        tenant: new Set(byTenant ? clean(query.tenantIds) : []),
    };
    const valuesOf: Record<Dimension, (entry: Entry) => readonly string[]> = {
        server: (entry) => [entry.database.serverId],
        engine: (entry) => [entry.engine],
        job: (entry) => entry.jobs,
        state: (entry) => entry.states,
        tenant: (entry) => (entry.database.tenantId ? [entry.database.tenantId] : []),
    };
    const dimensions = Object.keys(picked) as Dimension[];
    const passes = (entry: Entry, omit?: Dimension) => dimensions.every((dimension) =>
        dimension === omit || picked[dimension].size === 0 || valuesOf[dimension](entry).some((value) => picked[dimension].has(value)));

    const found = search ? entries.filter((entry) => entry.name.toLowerCase().includes(search)) : entries;
    const facets: DatabaseFacets = { server: {}, engine: {}, job: {}, state: {}, ...(byTenant ? { tenant: {} } : {}) };
    for (const entry of found) {
        for (const dimension of dimensions) {
            const counts = facets[dimension];
            if (counts && passes(entry, dimension)) tally(counts, valuesOf[dimension](entry));
        }
    }
    if (!coverage) facets.job = {};

    const sort = query.sort ?? "size";
    const desc = query.desc ?? true;
    const compare = COMPARE[sort] ?? COMPARE.size;
    const shown = found
        .filter((entry) => passes(entry))
        .sort((a, b) => (desc ? compare(b, a) : compare(a, b)) || a.index - b.index);

    const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), DATABASE_MAX_PAGE_SIZE);
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const rows = shown.slice((page - 1) * pageSize, page * pageSize).map((entry) => entry.database);
    return { rows, total: shown.length, facets };
}
