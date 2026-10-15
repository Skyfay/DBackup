import { resolveStorageAdapter } from "@/lib/archive/storage-source";
import { entryKey } from "@/lib/archive/types";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { readBackupMetadata } from "@/services/restore/file-restore";
import type { SharedCopy } from "./shared-backups";

/**
 * The size of one dump inside a backup of a shared server. A customer sees the size of its own
 * dump and never the size of the archive, which holds every database of the server. The index
 * of the archive knows each dump, and reading it costs the small index file beside the backup.
 *
 * A backup never changes, so a size read once is kept in memory. The first look at a long list
 * reads only as many indexes as fit into a short time, the rest come in with the next look.
 */

const log = logger.child({ service: "SharedDumpSizes" });

export interface DumpSize {
    /** What the dump takes in the archive, compressed and encrypted like it was stored. */
    stored: number;
    /** The dump as the database server wrote it. */
    unpacked: number;
}

/** One dump to read, by the copies of its backup, the one to try first first. */
export interface DumpRequest {
    id: string;
    databaseName: string;
    copies: SharedCopy[];
}

/** Sizes kept, by backup and database. Null for one that could not be read, tried again later. */
const known = new Map<string, { size: DumpSize | null; at: number }>();
const KEEP = 20_000;
const RETRY_MS = 15 * 60_000;
/** Reads at once, so a long list does not open dozens of connections to one destination. */
const PARALLEL = 4;
/** How long a list waits for sizes it does not know yet. */
export const SIZE_BUDGET_MS = 2_500;

const keyOf = (request: DumpRequest) => `${request.id}\n${request.databaseName}`;

function remember(key: string, size: DumpSize | null): void {
    if (known.size >= KEEP) {
        const oldest = known.keys().next().value;
        if (oldest !== undefined) known.delete(oldest);
    }
    known.set(key, { size, at: Date.now() });
}

/** The size of the dump of a database in one copy of a backup, read from the index of the archive. */
async function readFrom(copy: SharedCopy, databaseName: string): Promise<DumpSize | null> {
    const { adapter, config } = await resolveStorageAdapter(copy.destinationId);
    const meta = await readBackupMetadata(adapter, config, copy.file);
    // The key the backup names, never a search through the keys of every tenant.
    const index = await archiveIndexService.load(copy.destinationId, copy.file, meta, copy.profileId ? { profileId: copy.profileId } : undefined);
    const dump = index?.databases.find((entry) => entry.name === databaseName);
    if (!index || !dump) return null;
    const entry = index.entries.get(entryKey(undefined, dump.n));
    return { stored: entry?.size ?? dump.s, unpacked: dump.s };
}

/** Reads one size, trying the copies in turn, and keeps what came out. */
async function readSize(request: DumpRequest): Promise<DumpSize | null> {
    for (const copy of request.copies) {
        try {
            const size = await readFrom(copy, request.databaseName);
            if (size) {
                remember(keyOf(request), size);
                return size;
            }
        } catch (error: unknown) {
            log.warn("Reading the size of a shared dump failed", { destinationId: copy.destinationId }, wrapError(error));
        }
    }
    remember(keyOf(request), null);
    return null;
}

/** The size kept for a dump: the size, null when it could not be read lately, undefined when unknown. */
export function knownSize(request: DumpRequest, now = Date.now()): DumpSize | null | undefined {
    const entry = known.get(keyOf(request));
    if (!entry) return undefined;
    if (entry.size === null && now - entry.at > RETRY_MS) return undefined;
    return entry.size;
}

/**
 * The sizes of many dumps, by the id of their backup. What is kept answers at once, the rest is
 * read in the order given, newest first by the caller, until the budget runs out. Reads that
 * started keep going and are kept for the next call.
 */
export async function dumpSizes(requests: readonly DumpRequest[], budgetMs = SIZE_BUDGET_MS): Promise<Map<string, DumpSize | null>> {
    const sizes = new Map<string, DumpSize | null>();
    const missing: DumpRequest[] = [];
    for (const request of requests) {
        const size = knownSize(request);
        if (size === undefined) missing.push(request);
        else sizes.set(request.id, size);
    }
    if (missing.length === 0) return sizes;

    const deadline = Date.now() + budgetMs;
    let next = 0;
    const worker = async () => {
        while (next < missing.length && Date.now() < deadline) {
            const request = missing[next++];
            sizes.set(request.id, await readSize(request));
        }
    };
    const workers = Promise.all(Array.from({ length: Math.min(PARALLEL, missing.length) }, worker));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([workers, new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); })]);
    if (timer) clearTimeout(timer);
    // A copy, since the reads that are still under way go on writing into the map.
    return new Map(sizes);
}

/** Forgets every size, for tests. */
export function forgetDumpSizes(): void {
    known.clear();
}
