import prisma from "@/lib/prisma";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "KeyAliases" });

/** The other profile ids a key stands for, from the column that keeps them as JSON. */
export function aliasesOf(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    } catch {
        return [];
    }
}

/**
 * Notes that a key opens the backups that name another profile id, one that was deleted or
 * belongs to another install. The Vault then counts those backups under the key instead of as
 * backups whose key is missing. Never throws, since it only sharpens what the Vault counts and
 * must not fail the restore that found the match.
 */
export async function rememberKeyFor(profileId: string, namedId: string | null | undefined): Promise<void> {
    if (!namedId || namedId === profileId) return;
    try {
        const profile = await prisma.encryptionProfile.findUnique({ where: { id: profileId }, select: { aliases: true } });
        if (!profile) return;
        const aliases = aliasesOf(profile.aliases);
        if (aliases.includes(namedId)) return;
        await prisma.encryptionProfile.update({ where: { id: profileId }, data: { aliases: JSON.stringify([...aliases, namedId]) } });
    } catch (error) {
        log.warn("Could not note which backups a key opens", { profileId }, wrapError(error));
    }
}
