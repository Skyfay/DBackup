import { describe, it, expect, vi } from "vitest";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { FileTooLargeError, SIDECAR_READ_LIMIT } from "@/lib/adapters/storage/common/read-limit";
import { LISTING_SERIAL_READ_CONCURRENCY, LISTING_SIDECAR_BYTES, readListedSidecars } from "@/services/storage/listed-sidecars";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const metaFile = (name: string): FileInfo => ({ name: `${name}.meta.json`, path: `job/${name}.meta.json`, size: 100, lastModified: new Date() });

/** An adapter whose reads take a moment each, counting how many run at once. */
function slowAdapter(readConcurrency: number | undefined, answer: (path: string) => Promise<string | null>) {
    let inFlight = 0;
    let most = 0;
    const read = vi.fn(async (_config: unknown, path: string) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        try {
            return await answer(path);
        } finally {
            inFlight--;
        }
    });
    const adapter = { id: "sftp", readConcurrency, read } as unknown as StorageAdapter;
    return { adapter, read, most: () => most };
}

describe("the sidecars of a destination listing", () => {
    it("reads a few at a time, never one per backup at once", async () => {
        const files = Array.from({ length: 40 }, (_, i) => metaFile(`b${i}.tar`));
        const serial = slowAdapter(undefined, async () => "{}");
        await readListedSidecars(serial.adapter, {}, files, "dest-1");
        expect(serial.most()).toBe(LISTING_SERIAL_READ_CONCURRENCY);

        const stateless = slowAdapter(8, async () => "{}");
        const map = await readListedSidecars(stateless.adapter, {}, files, "dest-1");
        expect(stateless.most()).toBe(8);
        expect(map.size).toBe(40);
    });

    it("asks every read for the sidecar limit", async () => {
        const { adapter, read } = slowAdapter(8, async () => "{}");
        await readListedSidecars(adapter, {}, [metaFile("a.tar")], "dest-1");
        expect(read).toHaveBeenCalledWith({}, "job/a.tar.meta.json", { maxBytes: SIDECAR_READ_LIMIT });
    });

    it("leaves out a sidecar past the limit and keeps the listing of the rest", async () => {
        const { adapter } = slowAdapter(8, async (path) => {
            if (path.includes("huge")) throw new FileTooLargeError(SIDECAR_READ_LIMIT);
            return JSON.stringify({ jobName: path });
        });
        const map = await readListedSidecars(adapter, {}, [metaFile("a.tar"), metaFile("huge.tar"), metaFile("b.tar")], "dest-1");
        expect([...map.keys()].sort()).toEqual(["a.tar", "b.tar"]);
    });

    it("leaves out a sidecar that does not parse", async () => {
        const { adapter } = slowAdapter(8, async (path) => (path.includes("bad") ? "{not json" : "{}"));
        const map = await readListedSidecars(adapter, {}, [metaFile("bad.tar"), metaFile("ok.tar")], "dest-1");
        expect([...map.keys()]).toEqual(["ok.tar"]);
    });
});

describe("what a listing keeps of a sidecar", () => {
    it("keeps the fields a row of the listing shows and drops the rest", async () => {
        const sidecar = {
            jobName: "Nightly", sourceType: "mysql", databases: { count: 2, names: ["a", "b"], extra: "x" },
            archive: { formatVersion: 2, encrypted: true, profileId: "p1", compression: "GZIP", indexFile: ".index", junk: "y".repeat(1000) },
            verification: { verifiedAt: "2026-10-01", passed: true, trigger: "manual", actualChecksum: "abc" },
            padding: "z".repeat(10_000),
        };
        const { adapter } = slowAdapter(8, async () => JSON.stringify(sidecar));
        const map = await readListedSidecars(adapter, {}, [metaFile("a.tar")], "dest-1");

        expect(map.get("a.tar")).toEqual({
            jobName: "Nightly", sourceType: "mysql", databases: { count: 2, names: ["a", "b"] },
            archive: { formatVersion: 2, encrypted: true, profileId: "p1", compression: "GZIP" },
            verification: { verifiedAt: "2026-10-01", passed: true, trigger: "manual" },
        });
    });

    it("keeps when the run started to dump, by which a shared backup is judged over its whole dump window", async () => {
        const sidecar = { jobName: "srv", sourceType: "mysql", sourceId: "srv-1", databases: { count: 1, names: ["crm"] }, timestamp: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:00:00.000Z", archive: { formatVersion: 2 } };
        const { adapter } = slowAdapter(8, async () => JSON.stringify(sidecar));
        const map = await readListedSidecars(adapter, {}, [metaFile("crm.tar")], "dest-1");
        const { describeBackupFromMetadata } = await import("@/services/storage/backup-file-fields");

        expect(map.get("crm.tar")?.dumpsStartedAt).toBe("2026-11-02T01:00:00.000Z");
        expect(describeBackupFromMetadata("crm.tar", map.get("crm.tar")!)).toEqual(expect.objectContaining({ createdAt: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:00:00.000Z" }));
    });

    it("leaves out a sidecar that is no object", async () => {
        const { adapter } = slowAdapter(8, async (path) => (path.includes("null") ? "null" : "[1]"));
        const map = await readListedSidecars(adapter, {}, [metaFile("null.tar"), metaFile("list.tar")], "dest-1");
        expect(map.size).toBe(0);
    });

    it("stops reading sidecars once one listing has read its budget of bytes", async () => {
        // Each sidecar is 1 MB of padding the listing drops, the same string every time.
        const big = JSON.stringify({ jobName: "j", padding: "p".repeat(1024 * 1024) });
        const read = vi.fn(async () => big);
        const adapter = { id: "sftp", readConcurrency: 1, read } as unknown as StorageAdapter;
        const count = Math.ceil(LISTING_SIDECAR_BYTES / Buffer.byteLength(big)) + 20;
        const map = await readListedSidecars(adapter, {}, Array.from({ length: count }, (_, i) => metaFile(`b${i}.tar`)), "dest-1");

        expect(read.mock.calls.length).toBeLessThan(count);
        expect(read.mock.calls.length * Buffer.byteLength(big)).toBeLessThanOrEqual(LISTING_SIDECAR_BYTES);
        expect(map.size).toBe(read.mock.calls.length);
    });
});
