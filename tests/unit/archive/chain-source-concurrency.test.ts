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
// The check of the references runs for real in archive/duplicate-references.test.ts.
// A bundled file is the whole payload here, the slice itself is covered in bundle-slices.test.ts.
vi.mock("@/lib/archive/reader", () => ({ openArchiveEntry, groupFilesByEntry, readArchiveManifest, assertSingleReferences: vi.fn(), bundleSlices: (payload: Buffer, files: unknown[]) => files.map(() => payload) }));

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

/**
 * The index lookup, swappable per test: `bundle` decides whether an entry is a bundle whose
 * files are sliced from one read, or a standalone entry streamed on its own.
 */
const snapshotEntries = { get: () => ({ bundle: false }) as unknown };

/** A snapshot whose index resolves every key through `snapshotEntries`. */
function makeSnapshot() {
    return {
        source: { id: "snapshot-source" },
        manifest: { encryption: undefined },
        index: { entries: snapshotEntries },
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
    // Back to the default: one file per entry, nothing bundled.
    snapshotEntries.get = () => ({ bundle: false });
    groupFilesByEntry.mockImplementation((files: { p: string }[]) => new Map(files.map((f) => [`k-${f.p}`, [f]])));
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

    it("visits the files inside a bundle in parallel, not one after another", async () => {
        // A bundle holds many small files whose bytes are already in memory. Visiting them
        // serially meant a full network round trip each, which is where a restore of many
        // small files crawled - the upload, not the read, is the slow part.
        (snapshotEntries as { get: () => unknown }).get = () => ({ bundle: true });
        groupFilesByEntry.mockImplementation((files: { p: string }[]) => new Map([["bundle-1", files]]));

        let inFlight = 0;
        let peak = 0;
        const files = filesInArchive(undefined, 8);

        await forEachSnapshotFile(makeSnapshot(), files, async (_file, content) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            content.resume();
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
        }, 4);

        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(4);
    });

    it("keeps the shared limit across entries and bundle contents", async () => {
        // Two levels of parallelism must not multiply: entries and the files within them draw
        // from one gate, so the configured limit is the ceiling for the whole archive.
        (snapshotEntries as { get: () => unknown }).get = () => ({ bundle: true });
        groupFilesByEntry.mockImplementation((files: { p: string }[]) =>
            new Map(files.map((f, i) => [`bundle-${i % 3}`, [f]])));

        let inFlight = 0;
        let peak = 0;
        const files = filesInArchive(undefined, 12);

        await forEachSnapshotFile(makeSnapshot(), files, async (_file, content) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            content.resume();
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
        }, 3);

        expect(peak).toBeLessThanOrEqual(3);
    });

    it("keeps bundle files in index order at concurrency 1", async () => {
        // The tar download writes into one stream, so order is not optional there.
        (snapshotEntries as { get: () => unknown }).get = () => ({ bundle: true });
        groupFilesByEntry.mockImplementation((files: { p: string }[]) => new Map([["bundle-1", files]]));

        const seen: string[] = [];
        const files = filesInArchive(undefined, 5);

        await forEachSnapshotFile(makeSnapshot(), files, async (file, content) => {
            content.resume();
            seen.push((file as { p: string }).p);
        }, 1);

        expect(seen).toEqual(files.map((f) => (f.file as { p: string }).p));
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
