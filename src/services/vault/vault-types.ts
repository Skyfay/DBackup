import type { CredentialType } from "@/lib/core/credentials";

/**
 * The model of the Vault page: its credential profiles and its encryption keys, with what uses
 * them and what the audit log still knows about them. Plain data, so it crosses to the browser,
 * and nothing here imports server code, so the page may use its few rules too.
 */

/** Who did something and when, as far as the audit log still reaches. */
export interface VaultActor {
    at: string;
    /** The name of the user, null when the entry has none or the user is gone. */
    by: string | null;
}

// ------------------------------------------------------------------ credential profiles

/** Where a connection is listed, which is also the tab of the Connections page it opens on. */
export type VaultConnectionRole = "database" | "source" | "destination" | "notification";

/** A connection that logs in with a credential profile. */
export interface VaultConnection {
    id: string;
    name: string;
    adapterId: string;
    role: VaultConnectionRole;
    /** Its own login, or the one of the SSH server it reaches its target through. */
    slot: "primary" | "ssh";
    /** The last health check, null before the first one. */
    /** `AWAY` is an air-gapped destination that is not connected. */
    status: "ONLINE" | "DEGRADED" | "OFFLINE" | "AWAY" | null;
}

export interface VaultCredential {
    id: string;
    name: string;
    type: CredentialType;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    /** Which sensitive fields are set, without their values. */
    secretStatus?: Record<string, boolean>;
    /** The public half of an SSH key, which is no secret. */
    publicKey?: string;
    fingerprint?: string;
    /** What the profile holds, in a few words that name no secret, like "user backup". */
    holds: string;
    /** Why the profile needs a look, like an OAuth app that was never authorized. */
    attention: string | null;
    usedBy: VaultConnection[];
    created: VaultActor | null;
    changed: VaultActor | null;
    /** The last time its secret was revealed, and how often the audit log saw it. */
    revealed: VaultActor | null;
    reveals: number;
}

export interface VaultCredentialStats {
    profiles: number;
    /** How many kinds of profiles there are, and the most common one. */
    kinds: number;
    topKind: CredentialType | null;
    inUse: number;
    /** The connections that log in with a profile, each once. */
    connections: number;
    unused: number;
    /** Secrets revealed in the last 30 days, and the last of them. */
    revealed: number;
    lastReveal: (VaultActor & { profile: string }) | null;
}

export interface VaultCredentialsModel {
    profiles: VaultCredential[];
    stats: VaultCredentialStats;
    /** How many days the audit log keeps, which is how far back its facts reach. */
    auditDays: number;
}

// ------------------------------------------------------------------ encryption keys

export interface VaultKeyJob {
    id: string;
    name: string;
    enabled: boolean;
    /** The cron expression it runs on, from its preset when it follows one. */
    schedule: string;
    /** The adapter of its database, null for a job that only backs up folders. */
    sourceType: string | null;
    hasFolders: boolean;
}

/** How many backups made with a key lie at one destination. */
export interface VaultKeyDestination {
    id: string;
    name: string;
    adapterId: string;
    count: number;
}

export interface VaultKeyBackup {
    name: string;
    path: string;
    destinationId: string;
    destinationName: string;
    adapterId: string;
    size: number;
    createdAt: string | null;
    jobName: string | null;
}

/** A recovery kit that held a key. */
export interface VaultKit {
    at: string;
    by: string | null;
    /** How many keys the kit held, when the audit log still says. */
    keys: number | null;
}

export interface VaultKey {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    /** Tells keys apart without showing one, see `keyIdOf`. Null when the key cannot be read. */
    keyId: string | null;
    jobs: VaultKeyJob[];
    /** The config backup encrypts with this key. */
    configBackup: boolean;
    /** The backups made with the key at every destination, from their cached listings. */
    backups: number;
    destinations: VaultKeyDestination[];
    /** Its newest backups, which the delete dialog names. */
    recent: VaultKeyBackup[];
    /** The last recovery kit that held it, null when it was never in one. */
    kit: VaultKit | null;
    created: VaultActor | null;
    revealed: VaultActor | null;
}

/** Whether new backups are encrypted with a key, by a job or by the config backup. */
export function isKeyInUse(key: Pick<VaultKey, "jobs" | "configBackup">): boolean {
    return key.jobs.length > 0 || key.configBackup;
}

/** Backups that name a key the Vault does not have, which nothing here can open. */
export interface VaultMissingKeys {
    count: number;
    /** How many different keys they name. */
    keys: number;
    destinations: VaultKeyDestination[];
}

export interface VaultKeyStats {
    keys: number;
    /** The jobs that encrypt. */
    jobs: number;
    /** The keys a job or the config backup encrypts with. */
    keysInUse: number;
    /** Every backup at every destination, and the encrypted ones among them. */
    backups: number;
    encrypted: number;
    missing: VaultMissingKeys;
    /** The keys that were never in a recovery kit, by name. */
    neverInKit: string[];
    lastKit: VaultKit | null;
}

export interface VaultKeysModel {
    keys: VaultKey[];
    stats: VaultKeyStats;
    auditDays: number;
}
