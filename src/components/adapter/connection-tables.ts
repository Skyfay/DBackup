/**
 * Names of the four connection tables, under which each user's column layout is saved.
 * A plain module, so the server page can load the layouts without importing client code.
 */
export const CONNECTION_TABLE_IDS = {
    databases: "connections.databases",
    "directory-sources": "connections.directory-sources",
    destinations: "connections.destinations",
    notifications: "connections.notifications",
} as const;

/** The page id under which each user's choice of table or cards is saved. */
export const CONNECTIONS_PAGE_ID = "connections";

/** How many connections each tab holds, left out for tabs the user can not open. */
export interface ConnectionCounts {
    databases?: number;
    sources?: number;
    destinations?: number;
    notifications?: number;
}
