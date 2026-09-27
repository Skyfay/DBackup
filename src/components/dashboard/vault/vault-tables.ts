/**
 * Names of the two tables of the Vault, under which each user's column layout is saved. A plain
 * module, so the server page can load the layouts without importing client code.
 */
export const VAULT_TABLE_IDS = {
    credentials: "vault.credentials",
    keys: "vault.keys",
} as const;

/** How many entries each tab holds, left out for a tab the viewer cannot open. */
export interface VaultCounts {
    credentials?: number;
    keys: number;
}
