/**
 * The name under which each user's column layout of the users table is saved, and the tabs of the
 * page. A plain module, so the server page can use them without importing client code.
 */
export const USERS_TABLE_ID = "users.users";

export type UsersPageTab = "users" | "groups" | "apikeys" | "audit" | "sso";

/** How many entries each tab holds, left out for a tab the viewer cannot open or without a count. */
export type UsersPageCounts = Partial<Record<UsersPageTab, number>>;
