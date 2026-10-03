/**
 * What the API keys tab of the Users & Groups page shows: every key with its owner, what it may
 * do and how it was used, and a panel with the runs it started. Plain data, so the browser can
 * import it without the services behind it. Never a secret or a hash.
 */

export type ApiKeyState = "enabled" | "disabled" | "expired";

/** A working key that runs out within this counts as running out soon, marked amber. */
export const SOON_MS = 14 * 86_400_000;

/** A working key that runs out within two weeks, for the badge, the quick filter and the numbers above the list. */
export const runsOutSoon = (key: { state: ApiKeyState; expiresAt: string | null }, now: number): boolean =>
    key.state === "enabled" && key.expiresAt !== null && Date.parse(key.expiresAt) - now <= SOON_MS;

export interface ApiKeyOwner {
    id: string;
    name: string;
    email: string;
    image: string | null;
    groupName: string | null;
}

export interface ApiKeyRow {
    id: string;
    name: string;
    /** "dbackup_" and the first 8 characters of the secret. */
    prefix: string;
    /** As stored. */
    permissions: string[];
    /** What it may do right now: the stored ones its owner still has. */
    effective: string[];
    /** Stored but paused, since the group of the owner lacks them. */
    paused: string[];
    /** The most the group of the owner lets a key get, for the editor. */
    ownerPermissions: string[];
    owner: ApiKeyOwner;
    state: ApiKeyState;
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    /** The newest run the key started. */
    lastRun: { job: string | null; at: string; status: string } | null;
    isMine: boolean;
}

export interface ApiKeysStats {
    keys: number;
    working: number;
    disabled: number;
    expired: number;
    /** Names of the working keys that run out within two weeks. */
    soon: string[];
    /** Names of the keys never used. */
    never: string[];
    /** Names of the keys that may do more than read. */
    beyondReading: string[];
    owners: string[];
}

export interface ApiKeysModel {
    keys: ApiKeyRow[];
    stats: ApiKeysStats;
    /** What the viewer may do, the most a key they make, change or rotate may get. */
    viewer: { id: string; superAdmin: boolean; permissions: string[] };
}

export interface ApiKeyRun {
    id: string;
    job: string | null;
    status: string;
    at: string;
}

export interface ApiKeyDetails {
    id: string;
    /** The newest runs the key started. */
    runs: ApiKeyRun[];
    made: { at: string; by: string | null } | null;
    rotated: { at: string; by: string | null } | null;
    auditDays: number;
}
