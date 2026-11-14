import type { AdapterConfig, BackupMetadata, FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { mapWithConcurrency } from "@/lib/concurrency";
import { isFileTooLarge, SIDECAR_READ_LIMIT } from "@/lib/adapters/storage/common/read-limit";
import { METADATA_SIDECAR_SUFFIX } from "@/lib/core/backup-files";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "StorageService" });

/**
 * How many sidecars a listing reads at once on a destination whose `read()` opens a connection or
 * a process per call. Such an adapter declares no `readConcurrency`, see `read-concurrency.ts`.
 */
export const LISTING_SERIAL_READ_CONCURRENCY = 2;

/** How many sidecars a listing of this destination reads at once, never more than its `readConcurrency`. */
export function listingReadConcurrency(adapter: StorageAdapter): number {
    return Math.max(1, adapter.readConcurrency ?? LISTING_SERIAL_READ_CONCURRENCY);
}

/**
 * The most bytes of sidecars one listing reads. Each sidecar stops at `SIDECAR_READ_LIMIT`, but a
 * destination a customer fills may hold any number of them, and the listings of every tenant run
 * in the one process. A real sidecar holds a few KB, so this covers tens of thousands of backups.
 * Past it the rest of the listing goes without its sidecars, with one log line.
 */
export const LISTING_SIDECAR_BYTES = 256 * 1024 * 1024;

/** The fields of an object a listing keeps, of those the object has. */
function pick(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
    return out;
}

/** The plain fields of a sidecar `describeBackupFromMetadata` reads. */
const LISTED_FIELDS = [
    "sourceType", "jobId", "jobName", "timestamp", "dumpsStartedAt", "sourceId", "sourceName", "engineVersion", "engineEdition",
    "compression", "locked", "checksum", "checksumMd5", "backupType", "onlyDatabases", "logicalSize",
] as const;

/**
 * What a listing keeps of a parsed sidecar: the fields `describeBackupFromMetadata` reads, and of
 * its objects only theirs. A sidecar may carry anything its writer put there, so the rest is
 * dropped as soon as it is parsed rather than held for the whole listing. Null for a sidecar that
 * is no object.
 */
export function listedFieldsOf(parsed: unknown): BackupMetadata | null {
    const top = pick(parsed, LISTED_FIELDS);
    if (!top) return null;
    const meta = parsed as Record<string, unknown>;
    const nested: Record<string, unknown> = {
        encryption: pick(meta.encryption, ["enabled", "profileId"]),
        archive: pick(meta.archive, ["encrypted", "profileId", "compression", "formatVersion"]),
        combined: pick(meta.combined, ["databases", "directorySources"]),
        chain: pick(meta.chain, ["id", "type", "base", "index"]),
        trigger: pick(meta.trigger, ["type", "actor"]),
        verification: pick(meta.verification, ["verifiedAt", "passed", "trigger"]),
        databases: typeof meta.databases === "number" || Array.isArray(meta.databases) ? meta.databases : pick(meta.databases, ["count", "names"]),
    };
    for (const [key, value] of Object.entries(nested)) if (value !== undefined) top[key] = value;
    return top as BackupMetadata;
}

/**
 * The `.meta.json` files of a listing, by the name of the backup they lie beside.
 *
 * Read a few at a time, since a destination may hold thousands of backups and the hourly tasks
 * list every destination. Each read stops at `SIDECAR_READ_LIMIT`, and a sidecar past it is left
 * out with a log line, like one that does not parse, so one oversized file does not fail the
 * whole listing. Of each only `listedFieldsOf` is kept, and all of them together stop at
 * `LISTING_SIDECAR_BYTES`, the rest left out with one log line.
 */
export async function readListedSidecars(
    adapter: StorageAdapter,
    config: AdapterConfig,
    metaFiles: readonly FileInfo[],
    adapterConfigId: string
): Promise<Map<string, BackupMetadata>> {
    const metadataMap = new Map<string, BackupMetadata>();
    if (!adapter.read) return metadataMap;
    // The bytes read so far, and for each read that runs the most it may bring, so the reads at once
    // never carry the total past the budget. A read that ends puts back what it did not use.
    let spent = 0;
    let skipped = 0;
    await mapWithConcurrency(metaFiles, listingReadConcurrency(adapter), async (metaFile) => {
        if (spent + SIDECAR_READ_LIMIT > LISTING_SIDECAR_BYTES) {
            skipped++;
            return;
        }
        spent += SIDECAR_READ_LIMIT;
        let content: string | null = null;
        try {
            content = await adapter.read!(config, metaFile.path, { maxBytes: SIDECAR_READ_LIMIT });
            const fields = content ? listedFieldsOf(JSON.parse(content)) : null;
            if (fields) metadataMap.set(metaFile.name.slice(0, -METADATA_SIDECAR_SUFFIX.length), fields);
        } catch (error) {
            if (isFileTooLarge(error)) {
                log.warn("Skipping a backup sidecar larger than any backup writes", { adapterConfigId, path: metaFile.path, limit: SIDECAR_READ_LIMIT });
                return;
            }
            log.debug("Skipping a backup sidecar that does not read", { adapterConfigId, path: metaFile.path, error: wrapError(error).message });
        } finally {
            spent += (content ? Buffer.byteLength(content) : 0) - SIDECAR_READ_LIMIT;
        }
    });
    if (skipped > 0) {
        log.warn("Listed a destination without some of its sidecars, past the bytes one listing reads", { adapterConfigId, skipped, limit: LISTING_SIDECAR_BYTES });
    }
    return metadataMap;
}
