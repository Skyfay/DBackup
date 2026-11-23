/**
 * What the platform lets a tenant add itself, or not: the kinds of connection and API keys. Plain
 * data, so the pages read it as well as the services. See `src/services/tenant/tenant-allowances.ts`.
 */

export const ALLOWANCE_KINDS = ["databases", "directorySources", "destinations", "channels", "apiKeys"] as const;

export type AllowanceKind = (typeof ALLOWANCE_KINDS)[number];

/** Whether the tenant adds each kind itself. */
export type TenantAllowances = Record<AllowanceKind, boolean>;

/** Everything allowed, the start of every tenant. */
export const ALL_ALLOWED: TenantAllowances = { databases: true, directorySources: true, destinations: true, channels: true, apiKeys: true };

/** What one of a kind is called in a sentence. */
export const ALLOWANCE_NOUNS: Record<AllowanceKind, string> = {
    databases: "database connections",
    directorySources: "directory sources",
    destinations: "destinations",
    channels: "notification channels",
    apiKeys: "API keys",
};

/** The label of a kind on the page of the limits. */
export const ALLOWANCE_LABELS: Record<AllowanceKind, string> = {
    databases: "Database connections",
    directorySources: "Directory sources",
    destinations: "Destinations",
    channels: "Channels",
    apiKeys: "API keys",
};

/** Whether a set of allowances holds back anything. */
export const limitsAnything = (allowances: TenantAllowances) => ALLOWANCE_KINDS.some((kind) => !allowances[kind]);
