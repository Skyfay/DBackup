/**
 * The name under which each user's column layout of the users table is saved, and the tabs of the
 * page. A plain module, so the server page can use them without importing client code.
 */

import type { TabAttention } from "@/lib/core/tab-attention";

export const USERS_TABLE_ID = "users.users";

export type UsersPageTab = "users" | "groups" | "apikeys" | "sso" | "audit";

/** What needs a look in each tab, left out for a tab the viewer cannot open or with nothing to fix. */
export type UsersPageAttention = Partial<Record<UsersPageTab, TabAttention>>;
