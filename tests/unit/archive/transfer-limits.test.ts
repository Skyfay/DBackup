// @vitest-environment node
/**
 * What a reader takes from the server of a destination, which a customer may own: a ranged read
 * no more than the range it asked for, the manifest and the tail of an archive no more than they
 * may hold, and the index sidecar no more than any backup stores, stopped during the transfer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { cappedRange, openStorageArchiveSource } from "@/lib/archive/storage-source";
import { readArchiveManifest, readEmbeddedIndexBytes } from "@/lib/archive/reader";
import { readAll } from "@/lib/archive/sources";
import { DamagedBackupError, INDEX_MAX_STORED_BYTES } from "@/lib/archive/limits";
import { buildUstarHeader } from "@/lib/archive/tar-blocks";
import { FileTooLargeError } from "@/lib/adapters/storage/common/read-limit";
import type { ArchiveByteSource } from "@/lib/archive/types";
import type { StorageAdapter } from "@/lib/core/interfaces";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/** The destination of the index sidecar, an adapter with `readBytes` the test sets. */
const destination = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: async () => ({ adapter: destination.adapter, config: {} }),
}));

/** An endless stream, counting what it was asked for. */
function endless(counter: { chunks: number }): Readable {
    return new Readable({
        read() {
            counter.chunks++;
            this.push(Buffer.alloc(64 * 1024, 0x41));
        },
    });
}

describe("a ranged read", () => {
    it("passes exactly the range it asked for", async () => {
        const bytes = await readAll(cappedRange(Readable.from([Buffer.alloc(100)]), 0, 99));
        expect(bytes.length).toBe(100);
    });

    it("fails at the first byte past the range, as from a server that ignores Range", async () => {
        const counter = { chunks: 0 };
        await expect(readAll(cappedRange(endless(counter), 10, 1033))).rejects.toBeInstanceOf(DamagedBackupError);
        expect(counter.chunks).toBeLessThan(8);
    });

    it("of an adapter is capped before any reader sees it", async () => {
        const counter = { chunks: 0 };
        const adapter = {
            id: "webdav",
            download: vi.fn(),
            // Ignores the range and sends the whole file, and more.
            downloadRange: vi.fn(async () => endless(counter)),
        } as unknown as StorageAdapter;
        const managed = await openStorageArchiveSource(adapter, {}, "job/backup.tar", 10 * 1024 * 1024);

        await expect(readAll(await managed.source.read(0, 511))).rejects.toThrow(/The backup is damaged: a range the destination sent/);
        // A failure of the stream is no failure of the request, so the archive is never fetched whole.
        expect(adapter.download).not.toHaveBeenCalled();
        await managed.dispose();
    });
});

describe("the reader of an archive", () => {
    /** A source of the bytes given, that answers every range with all of them from its start. */
    const careless = (bytes: Buffer, size?: number): ArchiveByteSource => ({
        size,
        read: async () => Readable.from([bytes]),
    });

    it("refuses a manifest larger than any writer stores by its header, before it is fetched", async () => {
        const reads: [number, number][] = [];
        const head = Buffer.concat([buildUstarHeader("manifest.json", 64 * 1024 * 1024), Buffer.from("{}")]);
        const source: ArchiveByteSource = {
            read: async (start, end) => {
                reads.push([start, end]);
                return Readable.from([head.subarray(start, end + 1)]);
            },
        };

        await expect(readArchiveManifest(source)).rejects.toBeInstanceOf(DamagedBackupError);
        expect(reads).toHaveLength(1);
    });

    it("takes no more of the head than it asked for", async () => {
        const manifest = Buffer.from(JSON.stringify({ version: 2 }));
        const archive = Buffer.concat([buildUstarHeader("manifest.json", manifest.length), manifest, Buffer.alloc(64 * 1024)]);
        await expect(readArchiveManifest(careless(archive))).rejects.toBeInstanceOf(DamagedBackupError);
    });

    it("takes no more of the tail than the window it asked for", async () => {
        await expect(readEmbeddedIndexBytes(careless(Buffer.alloc(4 * 1024 * 1024), 2048))).rejects.toBeInstanceOf(DamagedBackupError);
    });
});

describe("the index sidecar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("is read with readBytes up to what any backup stores, never downloaded to the temp folder", async () => {
        const readBytes = vi.fn(async () => Buffer.from("sealed"));
        const download = vi.fn();
        destination.adapter = { id: "s3", readBytes, download };
        const { archiveIndexService } = await import("@/services/backup/archive-index-service");

        expect((await archiveIndexService.fetchSidecar("dest-1", "job/backup.tar", ".index"))?.toString()).toBe("sealed");
        expect(readBytes).toHaveBeenCalledWith({}, "job/backup.tar.index", { maxBytes: INDEX_MAX_STORED_BYTES });
        expect(download).not.toHaveBeenCalled();
    });

    it("larger than that is refused as missing, and the archive's own index is read instead", async () => {
        const download = vi.fn();
        destination.adapter = { id: "s3", readBytes: vi.fn(async () => { throw new FileTooLargeError(INDEX_MAX_STORED_BYTES); }), download };
        const { archiveIndexService } = await import("@/services/backup/archive-index-service");

        expect(await archiveIndexService.fetchSidecar("dest-1", "job/backup.tar", ".index")).toBeNull();
        expect(download).not.toHaveBeenCalled();
    });
});
