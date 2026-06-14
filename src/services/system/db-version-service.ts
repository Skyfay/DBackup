import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { compareVersions } from "@/lib/utils";

const log = logger.child({ service: "DbVersionService" });

export interface RecordVersionResult {
    /** True when a new history row was inserted (version differed or first run). */
    changed: boolean;
    /** Previous version stored before this record (null if this was the first entry). */
    previousVersion: string | null;
    /** The version stored as `newVersion` on the latest entry. */
    newVersion: string;
    /** True when the new version is numerically lower than the previous version. */
    isDowngrade: boolean;
}

/**
 * Normalizes a version string for comparison. Trims whitespace; treats empty
 * strings as null. Comparison itself remains a string equality check (we do
 * not parse semver to keep the behaviour stable across all adapters).
 */
function normalize(version: string | null | undefined): string | null {
    if (version == null) return null;
    const trimmed = version.trim();
    return trimmed.length === 0 ? null : trimmed;
}

/**
 * Inserts a `DbVersionHistory` row only when the supplied version differs
 * from the latest stored entry for the given source (or when no entry exists yet).
 *
 * Returns information about the comparison so callers can dispatch
 * notifications when `changed` is true.
 */
export async function recordVersionIfChanged(
    adapterConfigId: string,
    version: string,
    edition?: string | null
): Promise<RecordVersionResult> {
    const normalized = normalize(version);
    if (!normalized) {
        return { changed: false, previousVersion: null, newVersion: version, isDowngrade: false };
    }

    const latest = await prisma.dbVersionHistory.findFirst({
        where: { adapterConfigId },
        orderBy: { detectedAt: "desc" },
    });

    const previousVersion = latest ? normalize(latest.newVersion) : null;
    const previousEdition = latest ? normalize(latest.edition ?? null) : null;
    const normalizedEdition = normalize(edition ?? null);

    // No change when version (and edition, if present) match the last entry.
    if (latest && previousVersion === normalized && previousEdition === normalizedEdition) {
        return { changed: false, previousVersion, newVersion: normalized, isDowngrade: false };
    }

    const isDowngrade = previousVersion !== null && compareVersions(previousVersion, normalized) > 0;

    try {
        await prisma.dbVersionHistory.create({
            data: {
                adapterConfigId,
                previousVersion,
                newVersion: normalized,
                edition: normalizedEdition,
            },
        });
        log.info("Recorded database version change", {
            adapterConfigId,
            previousVersion,
            newVersion: normalized,
            isDowngrade,
        });
    } catch (e: unknown) {
        log.error("Failed to record version history", { adapterConfigId }, wrapError(e));
        return { changed: false, previousVersion, newVersion: normalized, isDowngrade: false };
    }

    return { changed: true, previousVersion, newVersion: normalized, isDowngrade };
}

/**
 * Returns recent version-history entries for a source, newest first.
 */
export async function listVersionHistory(adapterConfigId: string, limit = 100) {
    return prisma.dbVersionHistory.findMany({
        where: { adapterConfigId },
        orderBy: { detectedAt: "desc" },
        take: Math.max(1, Math.min(limit, 500)),
    });
}
