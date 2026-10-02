import type { CredentialType } from "@/lib/core/credentials";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { listCredentialProfilesForVault } from "@/services/auth/credential-service";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { credentialAudit, type CredentialAudit } from "./vault-audit";
import type { VaultConnection, VaultConnectionRole, VaultCredential, VaultCredentialsModel } from "./vault-types";
import { isNotConnected } from "@/lib/core/air-gap";

/** The window of the reveals above the list. */
const REVEAL_WINDOW_MS = 30 * 86_400_000;

export type ListedProfile = Awaited<ReturnType<typeof listCredentialProfilesForVault>>[number];

type ListedUse = ListedProfile["uses"][number];

function roleOf(use: Pick<ListedUse, "type" | "storageRole">): VaultConnectionRole {
    if (use.type === "database") return "database";
    if (use.type === "notification") return "notification";
    return use.storageRole === STORAGE_ROLES.SOURCE ? "source" : "destination";
}

function connectionOf(use: ListedUse): VaultConnection {
    // An air-gapped destination that is not connected is away on purpose, never offline.
    const status = isNotConnected(use) ? "AWAY" : use.lastStatus === "DEGRADED" || use.lastStatus === "OFFLINE" ? use.lastStatus : "ONLINE";
    return {
        id: use.id,
        name: use.name,
        adapterId: use.adapterId,
        role: roleOf(use),
        slot: use.slot,
        status: use.lastHealthCheck ? status : null,
    };
}

/** The Credentials tab: every profile with the connections that log in with it and what the audit log knows. */
export function buildCredentialsModel(profiles: ListedProfile[], audit: CredentialAudit, auditDays: number, now = Date.now()): VaultCredentialsModel {
    const rows: VaultCredential[] = profiles.map((profile) => {
        const reveal = audit.reveals.get(profile.id);
        return {
            id: profile.id,
            name: profile.name,
            type: profile.type,
            description: profile.description,
            createdAt: profile.createdAt.toISOString(),
            updatedAt: profile.updatedAt.toISOString(),
            ...(profile.secretStatus ? { secretStatus: profile.secretStatus } : {}),
            ...(profile.publicKey ? { publicKey: profile.publicKey } : {}),
            ...(profile.fingerprint ? { fingerprint: profile.fingerprint } : {}),
            holds: profile.holds,
            attention: profile.attention,
            usedBy: profile.uses.map(connectionOf),
            created: audit.created.get(profile.id) ?? null,
            changed: audit.changed.get(profile.id) ?? null,
            revealed: reveal?.last ?? null,
            reveals: reveal?.count ?? 0,
        };
    });

    const kinds = new Map<CredentialType, number>();
    for (const row of rows) kinds.set(row.type, (kinds.get(row.type) ?? 0) + 1);
    const topKind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const names = new Map(rows.map((row) => [row.id, row.name]));
    const recent = audit.revealRows.filter((row) => now - Date.parse(row.at) <= REVEAL_WINDOW_MS);
    const last = recent[0];

    return {
        profiles: rows,
        stats: {
            profiles: rows.length,
            kinds: kinds.size,
            topKind,
            inUse: rows.filter((row) => row.usedBy.length > 0).length,
            connections: new Set(rows.flatMap((row) => row.usedBy.map((use) => use.id))).size,
            unused: rows.filter((row) => row.usedBy.length === 0).length,
            revealed: recent.length,
            lastReveal: last ? { at: last.at, by: last.by, profile: names.get(last.profileId) ?? "a deleted profile" } : null,
        },
        auditDays,
    };
}

/** Loads the Credentials tab of the Vault page. */
export async function getVaultCredentials(): Promise<VaultCredentialsModel> {
    const [profiles, retention] = await Promise.all([listCredentialProfilesForVault(), getDataRetentionValues()]);
    const audit = await credentialAudit(profiles.map((profile) => profile.id));
    return buildCredentialsModel(profiles, audit, retention.auditLog);
}
