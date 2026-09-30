/**
 * What the global search finds on the server, shared by its service, its route and the search in
 * the header. Plain data, so the browser can import it without the service behind it.
 */

/** Shorter than this finds too much to be of use. */
export const MIN_QUERY_LENGTH = 2;

/** The connections the viewer may see, by the type of their adapter. */
export type ConnectionType = "database" | "storage" | "notification";

/** Which kinds a search may find, from the permissions of the viewer. */
export interface SearchScope {
    jobs: boolean;
    runs: boolean;
    databases: boolean;
    connections: ConnectionType[];
}

export type SearchHit =
    | { kind: "job"; id: string; name: string; enabled: boolean; schedule: string; adapterId: string | null; lastStatus: string | null }
    | { kind: "connection"; id: string; name: string; adapterId: string; type: string; storageRole: string | null; status: string }
    | { kind: "database"; serverId: string; serverName: string; adapterId: string; name: string; sizeInBytes: number | null }
    | { kind: "run"; id: string; name: string; status: string; startedAt: string; adapterId: string | null };
