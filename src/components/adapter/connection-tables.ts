/**
 * Names of the four connection tables, under which each user's column layout is saved.
 * A plain module, so the server page can load the layouts without importing client code.
 */

import type { TabAttention } from "@/lib/core/tab-attention";

export const CONNECTION_TABLE_IDS = {
    databases: "connections.databases",
    "directory-sources": "connections.directory-sources",
    destinations: "connections.destinations",
    notifications: "connections.notifications",
} as const;

/** The page id under which each user's choice of table or cards is saved. */
export const CONNECTIONS_PAGE_ID = "connections";

/** What needs a look in each tab, left out for tabs the user can not open. */
export interface ConnectionAttention {
    databases?: TabAttention;
    sources?: TabAttention;
    destinations?: TabAttention;
    notifications?: TabAttention;
}
