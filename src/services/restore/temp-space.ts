import fs from "fs/promises";
import { getTempDir } from "@/lib/temp-dir";
import { ServiceError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { formatBytes } from "@/lib/utils";

const log = logger.child({ service: "RestoreTempSpace" });

/**
 * Free space a restore always leaves in the temporary folder, for the database of DBackup, the
 * runs of other tenants and whatever else writes there.
 */
export const TEMP_SPACE_RESERVE = 512 * 1024 * 1024;

/**
 * The most a restore stages at once: the sum of the `atOnce` largest of `sizes`. A restore writes
 * each dump or file to the temporary folder before it hands it on and removes it right after, so
 * at most as many lie there at a time as run at once, never the whole selection.
 */
export function stagedAtOnce(sizes: readonly number[], atOnce: number): number {
    const slots = Math.max(1, Math.floor(atOnce) || 1);
    return [...sizes]
        .filter((size) => Number.isFinite(size) && size > 0)
        .sort((a, b) => b - a)
        .slice(0, slots)
        .reduce((sum, size) => sum + size, 0);
}

/** Space a running restore was promised and has not given back yet. */
export interface TempSpaceReservation {
    /** Gives the space back. Called once the restore ends, also when it fails, and harmless twice. */
    release(): void;
}

/**
 * The bytes promised to restores that run now, in the memory of this process, which every restore
 * and every tenant shares. Each promise holds what its restore may still stage at once. The free
 * space of the folder only shows what is written already, so two restores that check at the same
 * moment would each see all of it free.
 */
let promisedBytes = 0;

/** The bytes promised to running restores now. */
export function promisedTempSpace(): number {
    return promisedBytes;
}

/**
 * Promises a restore the temporary space its staged entries need, or refuses it before anything is
 * written or any target touched. The caller releases the promise once the restore ends, in a
 * `finally`, so a failed restore gives it back too.
 *
 * The sizes are the `s` of the index lines, which the backup declares and a reader enforces, see
 * `byteLimit`. A compressed entry of a few bytes may declare terabytes and would inflate to them,
 * so the check runs before the first byte, against what `statfs` reports less the bytes promised
 * to the other running restores, with `TEMP_SPACE_RESERVE` kept back. Where the free space cannot
 * be read, nothing is refused and nothing promised.
 *
 * @param sizes - The declared plaintext size of each dump or file the restore stages
 * @param atOnce - How many it stages at the same time
 * @param folder - Where they are staged, the temporary folder when left out
 * @throws ServiceError with a sentence for the user that names no figure of the server
 */
export async function reserveTempSpace(sizes: readonly number[], atOnce: number, folder: string = getTempDir()): Promise<TempSpaceReservation> {
    const needed = stagedAtOnce(sizes, atOnce);
    if (needed === 0) return { release: () => { } };

    let free: number;
    try {
        const stats = await fs.statfs(folder);
        free = Number(stats.bavail) * Number(stats.bsize);
    } catch {
        return { release: () => { } };
    }

    // No await from here to the promise below, so no other restore checks in between.
    if (needed + promisedBytes + TEMP_SPACE_RESERVE > free) {
        log.warn("Refusing a restore larger than the free space of the temporary folder", { needed, free, promised: promisedBytes, reserve: TEMP_SPACE_RESERVE });
        throw new ServiceError(
            "RestoreService",
            "tempSpace",
            `This restore needs up to ${formatBytes(needed)} of temporary space at once, more than the server has free. ` +
            "Restore fewer or smaller items at a time, or ask the administrator of DBackup to free up space."
        );
    }

    promisedBytes += needed;
    let released = false;
    return {
        release: () => {
            if (released) return;
            released = true;
            promisedBytes -= needed;
        },
    };
}
