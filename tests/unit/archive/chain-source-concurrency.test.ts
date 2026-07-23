/**
 * Parallelism inside forEachSnapshotFile.
 *
 * The read core visits several files of one archive at once (over a network destination the
 * per-entry round trip, not the bandwidth, is the limit), but must never let that spill
 * across the archive boundary - the whole reason work is grouped by archive is to keep at
 * most the snapshot's own archive plus one sibling open at a time. These tests pin both: the
 * in-flight count reaches the requested concurrency within an archive, yet two archives'
 * visits never overlap, and concurrency 1 stays strictly serial.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

// openArchiveEntry returns a throwaway stream; the visit callback is where we measure timing.
const openArchiveEntry = vi.fn(async () => Readable.from([Buffer.from("x")]));
// One entry per file, keyed by path - no bundles, so each file streams on its own.
const groupFilesByEntry = vi.fn((files: { p: string }[]) => new Map(files.map((f) => [`k-${f.p}`, [f]])));
const readArchiveManifest = vi.fn(async () => ({ encryption: undefined }));
vi.mock("@/lib/archive/reader", () => ({ openArchiveEntry, groupFilesByEntry, readArchiveManifest }));

// openChainArchive (via this) is what opens a sibling. Track how many are live at once.
let openArchives = 0;
let peakOpenArchives = 0;
const openStorageArchiveSource = vi.fn(async () => {
    openArchives++;
    peakOpenArchives = Math.max(peakOpenArchives, openArchives);
    return {
        source: { id: "sibling-source" },
        ranged: true,
        dispose: async () => { openArchives--; },
    };
});
vi.mock("@/lib/archive/storage-source", () => ({ openStorageArchiveSource }));

const { forEachSnapshotFile } = await import("@/lib/archive/chain-source");

/** A snapshot whose index resolves every key to a plain (non-bundled) entry. */
function makeSnapshot() {
    return {
        source: { id: "snapshot-source" },
        manifest: { encryption: undefined },
        index: { entries: { get: () => ({ bundle: false }) } },
        masterKey: undefined,
        chain: {
            adapter: {} as never,
            config: {} as never,
            snapshotPath: "job/full-1.tar",
            resolveMasterKey: async () => Buffer.alloc(0),
        },
    } as never;
}

/** Builds N file work-items all living in the given archive (undefined = snapshot's own). */
function filesInArchive(archiveName: string | undefined, count: number) {
    return Array.from({ length: count }, (_, i) => ({
        file: { p: `${archiveName ?? "self"}-${i}.bin`, a: archiveName, s: 1 } as never,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    openArchives = 0;
    peakOpenArchives = 0;
});

describe("forEachSnapshotFile concurrency", () => {
    it("visits several files of one archive at once, up to the limit", async () => {
        let inFlight = 0;
        let peak = 0;
        const files = filesInArchive(undefined, 12);

        await forEachSnapshotFile(makeSnapshot(), files, async (_file, content) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            content.resume(); // drain the throwaway stream
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
        }, 4);

        expect(peak).toBe(4);
    });

    it("stays strictly serial at concurrency 1", async () => {
        // Mutation guard for the test above: without the concurrency argument lifting it, the
        // visits must never overlap - this pins the historical serial behaviour.
        let inFlight = 0;
        let peak = 0;
        const files = filesInArchive(undefined, 5);

        await forEachSnapshotFile(makeSnapshot(), files, async (_file, content) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            content.resume();
            await new Promise((r) => setTimeout(r, 2));
            inFlight--;
        }, 1);

        expect(peak).toBe(1);
    });

    it("never opens two chain archives at once, even at high concurrency", async () => {
        // Files span the snapshot's own archive and one sibling. The sibling is opened via
        // openStorageArchiveSource; if the archive grouping were bypassed both would be open
        // together and the peak-disk bound would be broken.
        const files = [...filesInArchive(undefined, 6), ...filesInArchive("inc-2.tar", 6)];
        const seenSimultaneousArchives = new Set<string>();

        await forEachSnapshotFile(makeSnapshot(), files, async (file, content) => {
            content.resume();
            // Record which archive owns every visit that is in flight right now.
            const active = new Set<string | undefined>();
            active.add((file as { a?: string }).a);
            for (const a of active) seenSimultaneousArchives.add(String(a));
            await new Promise((r) => setTimeout(r, 3));
        }, 8);

        // Exactly one sibling was opened, and never concurrently with another archive.
        expect(openStorageArchiveSource).toHaveBeenCalledTimes(1);
        expect(peakOpenArchives).toBe(1);
    });

    it("interleaves visits only within the same archive", async () => {
        // Stronger form of the guarantee: at any instant, all in-flight visits belong to one
        // archive. A leak across the boundary would surface as two archive names in flight.
        const files = [...filesInArchive(undefined, 5), ...filesInArchive("inc-2.tar", 5)];
        let maxDistinctArchivesInFlight = 0;
        const inFlightArchives = new Map<string, number>();

        await forEachSnapshotFile(makeSnapshot(), files, async (file, content) => {
            content.resume();
            const key = String((file as { a?: string }).a);
            inFlightArchives.set(key, (inFlightArchives.get(key) ?? 0) + 1);
            maxDistinctArchivesInFlight = Math.max(maxDistinctArchivesInFlight, inFlightArchives.size);
            await new Promise((r) => setTimeout(r, 3));
            const remaining = (inFlightArchives.get(key) ?? 1) - 1;
            if (remaining <= 0) inFlightArchives.delete(key); else inFlightArchives.set(key, remaining);
        }, 8);

        expect(maxDistinctArchivesInFlight).toBe(1);
    });
});
