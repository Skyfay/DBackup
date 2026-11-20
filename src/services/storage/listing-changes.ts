/**
 * Whether a backup a listing finds at a path is still the one its cached row describes.
 *
 * A job whose naming template always gives the same name writes every run to the same path, and
 * the storage keeps the older copies as versions of its own. The cached row of that path then holds
 * the sidecar of the first run, its time, its size and its checks, until something reads it again.
 */

type Described = { size?: number; lastModified?: Date | string };

const timeOf = (value: Date | string | undefined) => (value === undefined ? NaN : new Date(value).getTime());

/**
 * A backup counts as written again when its size changed, or when the storage dates it later than
 * the cached row and before the listing started. Some adapters put the time of the listing itself
 * on a file whose server names none, and such a time never counts, or every listing would read
 * every sidecar again. The row a run caches after its upload carries the time of DBackup, after
 * the storage's own, so its next listing leaves it alone.
 */
export function wasRewritten(cached: Described, listed: Described, listingStartedAt: number): boolean {
    if (typeof cached.size === "number" && typeof listed.size === "number" && cached.size !== listed.size) return true;
    const before = timeOf(cached.lastModified);
    const now = timeOf(listed.lastModified);
    if (Number.isNaN(before) || Number.isNaN(now)) return false;
    return now > before && now < listingStartedAt;
}
