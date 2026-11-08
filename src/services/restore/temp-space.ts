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
        throw tempSpaceRefusal(needed);
    }
    return promise(needed);
}

/** The refusal of a restore that needs more temporary space than the server has free. */
export function tempSpaceRefusal(needed: number): ServiceError {
    return new ServiceError(
        "RestoreService",
        "tempSpace",
        `This restore needs up to ${formatBytes(needed)} of temporary space at once, more than the server has free. ` +
        "Restore fewer or smaller items at a time, or ask the administrator of DBackup to free up space."
    );
}

/** Adds `bytes` to the promised space until the reservation is released. */
function promise(bytes: number): TempSpaceReservation {
    promisedBytes += bytes;
    let released = false;
    return {
        release: () => {
            if (released) return;
            released = true;
            promisedBytes -= bytes;
        },
    };
}

/** Space promised to an output whose size is known only by a bound, see `reserveTempSpaceUpTo`. */
export interface BoundedTempSpace extends TempSpaceReservation {
    /** The most bytes the output may write: the bound, or the free space promised when that is less. */
    bytes: number;
    /** Whether `bytes` is the free space rather than the bound, so an output that reaches it ran out of room. */
    short: boolean;
}

/**
 * Promises an output known only by a bound, like a whole-file dump inflating to at most
 * `legacyInflateLimit` of its compressed size, as much of that bound as the temporary folder has
 * free beside the other restores and `TEMP_SPACE_RESERVE`. Promising the whole bound would refuse
 * every compressed dump of more than a few hundred MB, since the bound is 1100 times its size. The
 * caller stops the output at `bytes`, so it never writes more than it was promised.
 *
 * @param bound - The most bytes the output may ever write
 * @param folder - Where it is written, the temporary folder when left out
 * @throws ServiceError when no space is left at all
 */
export async function reserveTempSpaceUpTo(bound: number, folder: string = getTempDir()): Promise<BoundedTempSpace> {
    let free: number;
    try {
        const stats = await fs.statfs(folder);
        free = Number(stats.bavail) * Number(stats.bsize);
    } catch {
        return { bytes: bound, short: false, release: () => { } };
    }

    // No await from here to the promise below, so no other restore checks in between.
    const available = free - promisedBytes - TEMP_SPACE_RESERVE;
    if (available <= 0) {
        log.warn("Refusing a restore with no free space left in the temporary folder", { bound, free, promised: promisedBytes, reserve: TEMP_SPACE_RESERVE });
        throw tempSpaceRefusal(bound);
    }
    const bytes = Math.min(bound, available);
    return { ...promise(bytes), bytes, short: bytes < bound };
}
