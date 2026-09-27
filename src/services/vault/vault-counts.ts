import prisma from "@/lib/prisma";

/** How many credential profiles and keys the Vault holds, for the tabs of its page. */
export async function getVaultCounts(): Promise<{ credentials: number; keys: number }> {
    const [credentials, keys] = await Promise.all([prisma.credentialProfile.count(), prisma.encryptionProfile.count()]);
    return { credentials, keys };
}
