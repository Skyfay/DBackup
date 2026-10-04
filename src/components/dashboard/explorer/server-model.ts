import type { DatabaseOverview, ExplorerDatabase, ExplorerServer, ServerSummary, ServersOverview } from "@/services/databases/database-explorer-types";

/**
 * The rules of the Servers tab as plain functions: a row per server out of the overview and the
 * server summaries, the quick filters, the numbers of the strip and how long a version ran.
 */

export interface ServerRow {
    server: ExplorerServer;
    /** What the Servers tab adds, null while it loads. */
    summary: ServerSummary | null;
    databases: ExplorerDatabase[];
    /** Databases an enabled job backs up. */
    covered: number;
    /** Bytes of the databases whose size the server tells, null when it tells none. */
    size: number | null;
    /** A Redis or Valkey server, which is one entry of keys. */
    instance: ExplorerDatabase | null;
    /** The enabled jobs that back up any of its databases. */
    jobIds: string[];
}

export function serverRows(overview: DatabaseOverview, servers: ServersOverview | null): ServerRow[] {
    const summaries = new Map((servers?.servers ?? []).map((summary) => [summary.id, summary]));
    return overview.servers.map((server) => {
        const databases = overview.databases.filter((database) => database.serverId === server.id);
        const sized = databases.filter((database) => database.sizeInBytes !== null);
        return {
            server,
            summary: summaries.get(server.id) ?? null,
            databases,
            covered: databases.filter((database) => database.jobIds.length > 0).length,
            size: sized.length > 0 ? sized.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0) : null,
            instance: databases.find((database) => database.kind === "instance") ?? null,
            jobIds: overview.jobs.filter((job) => job.enabled && job.serverId === server.id).map((job) => job.id),
        };
    });
}

export type ServerQuick = "all" | "behind" | "uncovered";

/** Whether a server belongs in a quick filter. Uncovered has a database no job backs up. */
export function matchesQuick(row: ServerRow, quick: ServerQuick): boolean {
    switch (quick) {
        case "all":
            return true;
        case "behind":
            return row.summary?.behind != null;
        case "uncovered":
            return row.covered < row.databases.length;
    }
}

export function serverHref(serverId: string): string {
    return `/dashboard/explorer/server?server=${encodeURIComponent(serverId)}`;
}

/** The numbers above the list of servers. */
export function serversSummary(rows: ServerRow[]) {
    const engines = new Set(rows.map((row) => row.server.adapterId));
    const databases = rows.reduce((sum, row) => sum + row.databases.length, 0);
    const covered = rows.reduce((sum, row) => sum + row.covered, 0);
    const behind = rows.filter((row) => row.summary?.behind != null);
    const online = rows.filter((row) => row.server.status === "ONLINE").length;
    return { servers: rows.length, engines: engines.size, databases, covered, behind, online };
}

const DAY_MS = 86_400_000;

/** How long a version ran, in the unit that reads best: "10 days", "6.5 months", "2.1 years". */
export function timeOn(since: string | null, until: string | null, now: number): string | null {
    if (!since) return null;
    const days = Math.max(0, ((until ? Date.parse(until) : now) - Date.parse(since)) / DAY_MS);
    if (days < 1) return "less than a day";
    if (days < 60) return `${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"}`;
    if (days < 730) return `${(days / 30.44).toFixed(1).replace(/\.0$/, "")} months`;
    return `${(days / 365.25).toFixed(1).replace(/\.0$/, "")} years`;
}
