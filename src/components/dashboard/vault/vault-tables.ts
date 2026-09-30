/**
 * Names of the two tables of the Vault, under which each user's column layout is saved. A plain
 * module, so the server page can load the layouts without importing client code.
 */
export const VAULT_TABLE_IDS = {
    credentials: "vault.credentials",
    keys: "vault.keys",
} as const;

/** How many keys the Vault holds, since a recovery kit needs at least one. */
export interface VaultCounts {
    keys: number;
}
