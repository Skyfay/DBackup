import prisma from "@/lib/prisma";
import { attentionOf, type TabAttention } from "@/lib/core/tab-attention";
import { listCredentialProfilesForVault } from "@/services/auth/credential-service";
import { keyAudit } from "@/services/vault/vault-audit";

/** How many keys the Vault holds, since a recovery kit needs at least one. */
export async function getVaultCounts(): Promise<{ keys: number }> {
    return { keys: await prisma.encryptionProfile.count() };
}

export interface VaultAttention {
    credentials?: TabAttention;
    encryption?: TabAttention;
}

/**
 * The dots of the Vault tabs, what their strips mark amber: a credential profile its connections
 * cannot log in with, and a key that was never in a recovery kit, so a lost server takes it along.
 */
export async function getVaultAttention(canReadCredentials: boolean): Promise<VaultAttention> {
    const [profiles, keys] = await Promise.all([
        canReadCredentials ? listCredentialProfilesForVault() : Promise.resolve([]),
        prisma.encryptionProfile.findMany({ select: { id: true, name: true, kitDownloadedAt: true }, orderBy: { name: "asc" } }),
    ]);
    // A kit downloaded before the key remembered it is only in the audit log, which is read only when needed.
    const unmarked = keys.filter((key) => !key.kitDownloadedAt);
    const inKit = new Set(unmarked.length > 0 ? (await keyAudit(keys.map((key) => key.id))).kits.flatMap((kit) => kit.profileIds) : []);
    return {
        credentials: attentionOf("warning", profiles.filter((profile) => profile.attention).map((profile) => profile.name), "cannot log in", "cannot log in"),
        encryption: attentionOf("warning", unmarked.filter((key) => !inKit.has(key.id)).map((key) => key.name), "is in no recovery kit", "are in no recovery kit"),
    };
}
