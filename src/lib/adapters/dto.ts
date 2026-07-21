import { decryptConfig, redactSecrets, getSecretStatus } from "@/lib/crypto";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import type { StorageAdapter } from "@/lib/core/interfaces";
import prisma from "@/lib/prisma";

registerAdapters();

/**
 * Adapter-list Data Transfer Object.
 *
 * This is the ONLY shape the adapter-listing API serialises back to clients.
 * Its `config` field is rebuilt via `redactSecrets`, which DELETES every key in
 * `SENSITIVE_KEYS` — so the DTO structurally cannot carry a decrypted secret,
 * regardless of which adapter type or future field is added. `secretStatus`
 * tells the UI which secrets are set (so it can render "leave blank to keep")
 * without exposing the value.
 *
 * Do not add a field here that could hold a secret value. Secrets belong in the
 * Vault (`CredentialProfile`) and are surfaced only via the audited reveal flow.
 */
export interface AdapterListItemDTO {
    id: string;
    name: string;
    type: string;
    adapterId: string;
    /** JSON string of the structural config with all sensitive keys removed. */
    config: string;
    /** Map of sensitive key -> whether a non-empty value is stored. */
    secretStatus: Record<string, boolean>;
    metadata: string | null;
    createdAt: Date;
    updatedAt: Date;
    primaryCredentialId: string | null;
    sshCredentialId: string | null;
    defaultRetentionPolicyId: string | null;
    lastHealthCheck: Date | null;
    lastStatus: string;
    lastError: string | null;
    consecutiveFailures: number;
    /** Storage adapters only: whether this config can be picked as a directory-backup source. */
    usableAsSource: boolean;
    /** Storage adapters only: whether this config can be picked as a backup destination. */
    usableAsDestination: boolean;
    /** Storage adapters only: whether the folder tree picker (directory sources) can browse this adapter. */
    supportsBrowse: boolean;
}

/**
 * The minimum set of `AdapterConfig` row fields the DTO mapper needs. Kept loose
 * so Prisma rows can be passed directly without importing generated types.
 */
export interface AdapterRowInput {
    id: string;
    name: string;
    type: string;
    adapterId: string;
    config: string;
    metadata: string | null;
    createdAt: Date;
    updatedAt: Date;
    primaryCredentialId: string | null;
    sshCredentialId: string | null;
    defaultRetentionPolicyId: string | null;
    lastHealthCheck: Date | null;
    lastStatus: string;
    lastError: string | null;
    consecutiveFailures: number;
    usableAsSource: boolean;
    usableAsDestination: boolean;
}

/**
 * Maps a stored `AdapterConfig` row to the safe list DTO. Decrypts the config
 * internally only to compute `secretStatus` and to redact it — no decrypted
 * secret value ever leaves this function.
 */
export function toAdapterListItem(row: AdapterRowInput): AdapterListItemDTO {
    let config = "{}";
    let secretStatus: Record<string, boolean> = {};

    try {
        const parsed = JSON.parse(row.config);
        try {
            const decrypted = decryptConfig(parsed);
            secretStatus = getSecretStatus(decrypted);
            config = JSON.stringify(redactSecrets(decrypted));
        } catch {
            // Decryption failed (corrupt data / rotated key). Still redact secret
            // keys from the raw parsed config so structural fields survive without
            // leaking the (encrypted) secret values.
            secretStatus = getSecretStatus(parsed);
            config = JSON.stringify(redactSecrets(parsed));
        }
    } catch {
        // Unparseable config — return an empty structural config rather than the raw string.
        config = "{}";
        secretStatus = {};
    }

    return {
        id: row.id,
        name: row.name,
        type: row.type,
        adapterId: row.adapterId,
        config,
        secretStatus,
        metadata: row.metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        primaryCredentialId: row.primaryCredentialId,
        sshCredentialId: row.sshCredentialId,
        defaultRetentionPolicyId: row.defaultRetentionPolicyId,
        lastHealthCheck: row.lastHealthCheck,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
        consecutiveFailures: row.consecutiveFailures,
        usableAsSource: row.usableAsSource,
        usableAsDestination: row.usableAsDestination,
        supportsBrowse: row.type === "storage" && typeof (registry.get(row.adapterId) as StorageAdapter | undefined)?.browseDirectories === "function",
    };
}

/**
 * Server-side helper for pages that need adapter option lists without a client round-trip
 * (mirrors the query `GET /api/adapters?type=...` runs, kept in sync by sharing this function).
 */
export async function getAdapterOptions(type: "database" | "storage" | "notification"): Promise<AdapterListItemDTO[]> {
    const adapters = await prisma.adapterConfig.findMany({
        where: { type },
        orderBy: { createdAt: "desc" },
    });
    return adapters.map(toAdapterListItem);
}
