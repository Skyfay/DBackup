import { FileInfo, StorageAdapter, AdapterConfig } from "@/lib/core/interfaces";
import { METADATA_SIDECAR_SUFFIX } from "@/lib/core/backup-files";

/**
 * Loading the `.meta.json` sidecars that retention needs before it can decide anything.
 *
 * Four things live in there that a storage listing cannot tell us: whether a backup is
 * locked, which incremental chain it belongs to, which job made it, and when DBackup
 * actually wrote it. The last one matters most, because the destination's own mtime is not
 * trustworthy - see `backupTimestamp` on FileInfo.
 *
 * This runs at the end of every successful job, once per destination, over every backup
 * present. That is the reason it is worth being careful about how many round trips it
 * costs rather than just looping.
 */

/** How far mtime and the recorded creation time may drift before it is worth reporting. */
export const TIMESTAMP_DRIFT_WARNING_MS = 60 * 60 * 1000;

export interface SidecarLoadResult {
    /** Backups whose sidecar supplied a usable creation time. */
    withTimestamp: number;
    /**
     * Backups whose mtime disagrees with the recorded creation time by more than the
     * threshold. Reported by name, because a destination whose modification times were
     * reset is otherwise invisible until it has already cost backups.
     */
    drifted: { file: FileInfo; recorded: Date; modified: Date }[];
}

const normalize = (p: string) => p.replace(/\\/g, "/");

/**
 * Reads each backup's sidecar and annotates the FileInfo objects in place.
 *
 * @param listing The complete `list()` output, sidecars included. Used to skip reads for
 *                backups that have no sidecar at all, which costs nothing to check and
 *                saves a full round trip per pre-sidecar backup.
 * @param backups The subset the caller intends to apply retention to.
 */
export async function loadBackupSidecars(
    adapter: StorageAdapter,
    config: AdapterConfig,
    listing: FileInfo[],
    backups: FileInfo[]
): Promise<SidecarLoadResult> {
    const result: SidecarLoadResult = { withTimestamp: 0, drifted: [] };
    if (!adapter.read) return result;

    const sidecarPaths = new Set(
        listing
            .filter((f) => f.name.endsWith(METADATA_SIDECAR_SUFFIX))
            .map((f) => normalize(f.path))
    );

    // An adapter whose list() filters sidecars out would otherwise lose lock and chain
    // detection entirely, which is far worse than a wasted round trip. Only trust the
    // listing to answer "is there a sidecar" when it demonstrably reports them.
    const listingShowsSidecars = sidecarPaths.size > 0;

    const targets = listingShowsSidecars
        ? backups.filter((f) => sidecarPaths.has(normalize(f.path) + METADATA_SIDECAR_SUFFIX))
        : backups;

    // Serial unless the adapter says its read() carries no per-call protocol state.
    const concurrency = Math.max(1, adapter.readConcurrency ?? 1);

    for (let i = 0; i < targets.length; i += concurrency) {
        const batch = targets.slice(i, i + concurrency);
        await Promise.all(batch.map((file) => applySidecar(adapter, config, file, result)));
    }

    return result;
}

async function applySidecar(
    adapter: StorageAdapter,
    config: AdapterConfig,
    file: FileInfo,
    result: SidecarLoadResult
): Promise<void> {
    let meta: { locked?: boolean; chain?: { id?: string }; jobId?: string; timestamp?: string };
    try {
        const content = await adapter.read!(config, file.path + METADATA_SIDECAR_SUFFIX);
        if (!content) return;
        meta = JSON.parse(content);
    } catch {
        // A backup whose sidecar cannot be read is still a backup. It falls back to the
        // destination's mtime and counts as unlocked and chainless, which is what the
        // policy assumed before sidecars existed.
        return;
    }

    if (meta.locked) file.locked = true;
    if (meta.chain?.id) file.chainId = meta.chain.id;
    if (typeof meta.jobId === "string" && meta.jobId) file.jobId = meta.jobId;

    if (!meta.timestamp) return;
    const recorded = new Date(meta.timestamp);
    // A sidecar with an unparsable timestamp must not produce an Invalid Date, which would
    // poison every comparison it takes part in and sort unpredictably.
    if (Number.isNaN(recorded.getTime())) return;

    file.backupTimestamp = recorded;
    result.withTimestamp++;

    if (Math.abs(recorded.getTime() - file.lastModified.getTime()) > TIMESTAMP_DRIFT_WARNING_MS) {
        result.drifted.push({ file, recorded, modified: file.lastModified });
    }
}
