import { assertListingWithinLimits } from "./listing-limits";
import {
    AdapterConfig,
    ListTreeOptions,
    ListTreeProgress,
    ListTreeResult,
    StorageAdapter,
} from "@/lib/core/interfaces";

/**
 * How often listing progress may be reported.
 *
 * The callback ends up rewriting the execution's progress row, and a parallel walk resolves
 * directories far faster than anyone can read them. Chosen to stay well under what reads as
 * live while keeping the write rate flat regardless of how fast the server answers.
 */
const LIST_PROGRESS_INTERVAL_MS = 400;

/** Rate-limits progress reports, always letting the most recent one through eventually. */
function throttleProgress(
    onProgress: ((progress: ListTreeProgress) => void) | undefined
): ((progress: ListTreeProgress) => void) | undefined {
    if (!onProgress) return undefined;

    let last = 0;
    return (progress) => {
        const now = Date.now();
        if (now - last < LIST_PROGRESS_INTERVAL_MS) return;
        last = now;
        onProgress(progress);
    };
}

/**
 * Lists a source tree for collection, using the adapter's own walker where it has one.
 *
 * The fallback is the point of the split: an adapter without `listTree()` still works, it
 * simply pays for the whole tree up front and cannot be interrupted while doing so. Checking
 * the signal on both sides of that call is what keeps a cancelled run from also sitting
 * through the download loop afterwards.
 */
export async function listTreeForCollection(
    adapter: StorageAdapter,
    config: AdapterConfig,
    remotePath: string,
    options?: ListTreeOptions
): Promise<ListTreeResult> {
    options?.signal?.throwIfAborted();

    if (adapter.listTree) {
        const result = await adapter.listTree(config, remotePath, {
            ...options,
            onProgress: throttleProgress(options?.onProgress),
        });
        // The walkers of a server a customer may own check as they go. This holds every adapter
        // to the same limits, a walk that could not check as it ran included.
        assertListingWithinLimits(result.files);
        return result;
    }

    const files = await adapter.list(config, remotePath);
    options?.signal?.throwIfAborted();
    assertListingWithinLimits(files);
    // One report, after the fact. Honest about what happened: this path had nothing to say
    // until it was finished, which is exactly why listTree() exists.
    options?.onProgress?.({
        files: files.length,
        directories: 0,
        prunedDirectories: 0,
        currentPath: "",
    });
    return { files, pruned: [] };
}
