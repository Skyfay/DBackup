import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import fsp from "fs/promises";
import os from "os";
import nodePath from "path";
import { Writable } from "stream";

/**
 * Fake basic-ftp client.
 *
 * Reproduces the two behaviours the ranged read depends on: `downloadTo` honours the
 * `startAt` offset via REST, and `close()` aborts an in-flight transfer, which makes the
 * `downloadTo` promise reject.
 */
let FILE = crypto.randomBytes(200_000);

let closedAt: number | null;
let accessCalls: number;
let deliveredByServer: number;

class FakeClient {
    ftp = { verbose: false };
    private aborted = false;

    async access() { accessCalls++; }
    close() { this.aborted = true; closedAt = deliveredByServer; }
    async ensureDir() { }
    async size() { return FILE.length; }
    trackProgress() { }

    async downloadTo(destination: Writable, _path: string, startAt = 0): Promise<void> {
        // 8 KB at a time, like a real transfer.
        for (let offset = startAt; offset < FILE.length; offset += 8192) {
            if (this.aborted) {
                throw new Error("Client is closed");
            }
            const chunk = FILE.subarray(offset, Math.min(offset + 8192, FILE.length));
            deliveredByServer += chunk.length;
            destination.write(chunk);
            await new Promise((resolve) => setImmediate(resolve));
        }
        destination.end();
    }
}

vi.mock("basic-ftp", () => ({ Client: FakeClient, FileInfo: class { } }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}));

const { FTPAdapter } = await import("@/lib/adapters/storage/ftp");

const CONFIG = { host: "h", port: 21, username: "u", password: "p", tls: false } as never;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

beforeEach(() => {
    closedAt = null;
    accessCalls = 0;
    deliveredByServer = 0;
});

describe("FTP downloadRange", () => {
    it("returns exactly the requested bytes from the middle of the file", async () => {
        const stream = await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 50_000, 59_999);
        const actual = await readAll(stream);

        expect(actual.length).toBe(10_000);
        expect(actual.equals(FILE.subarray(50_000, 60_000))).toBe(true);
    });

    it("aborts the transfer instead of reading to the end of the file", async () => {
        await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 0, 9_999));

        // The server sent a little more than asked (chunk granularity), but nowhere near
        // the whole file - which is the entire point of the ranged read.
        expect(closedAt).not.toBeNull();
        expect(closedAt!).toBeLessThan(FILE.length / 2);
    });

    it("reads to the end of the file when the range ends there", async () => {
        const start = FILE.length - 1000;
        const actual = await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", start, FILE.length - 1));

        expect(actual.equals(FILE.subarray(start))).toBe(true);
    });

    it("handles a single-byte range", async () => {
        const actual = await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 1234, 1234));

        expect(actual).toEqual(FILE.subarray(1234, 1235));
    });

    it("returns nothing for an empty range without opening a connection", async () => {
        const actual = await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 100, 99));

        expect(actual).toHaveLength(0);
        expect(accessCalls).toBe(0);
    });

    it("uses one connection per range", async () => {
        await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 0, 999));
        await readAll(await FTPAdapter.downloadRange!(CONFIG, "backup.tar", 5000, 5999));

        // The control connection is unusable after an abort, so each range reconnects.
        expect(accessCalls).toBe(2);
    });
});

describe("FTP downloadRange serving a real archive", () => {
    let workDir: string;
    const MASTER_KEY = Buffer.alloc(32, 0x21);
    const original = FILE;

    afterEach(async () => {
        FILE = original;
        if (workDir) await fsp.rm(workDir, { recursive: true, force: true });
    });

    it("reads single files out of an encrypted archive over FTP ranges", async () => {
        const { createArchive } = await import("@/lib/archive/writer");
        const { openStorageArchiveSource } = await import("@/lib/archive/storage-source");
        const { readArchiveManifest, readArchiveIndex, readArchiveFile } = await import("@/lib/archive/reader");

        workDir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "ftp-archive-test-"));
        const sourceDir = nodePath.join(workDir, "src");
        await fsp.mkdir(sourceDir, { recursive: true });

        const contents: Record<string, Buffer> = {
            "www/index.php": Buffer.from("<?php echo 'ftp'; ?>\n".repeat(8)),
            "www/big.bin": crypto.randomBytes(250_000),
        };
        const files = [];
        for (const [rel, content] of Object.entries(contents)) {
            const target = nodePath.join(sourceDir, rel);
            await fsp.mkdir(nodePath.dirname(target), { recursive: true });
            await fsp.writeFile(target, content);
            files.push({ path: rel, size: content.length, mtime: "2026-07-22T10:00:00.000Z" });
        }

        const archivePath = nodePath.join(workDir, "backup.tar");
        await createArchive(
            [{ kind: "directory", jobSourceId: "src-1", label: "T", localPath: sourceDir, excludePatterns: [], files }],
            archivePath,
            { sourceType: "directory-only", compression: "GZIP", encryption: { masterKey: MASTER_KEY, profileId: "p1" } }
        );

        // The fake FTP server now serves the archive itself.
        FILE = await fsp.readFile(archivePath);

        const managed = await openStorageArchiveSource(FTPAdapter, CONFIG, "backup.tar", FILE.length);
        try {
            expect(managed.ranged).toBe(true);

            const manifest = await readArchiveManifest(managed.source);
            const index = await readArchiveIndex(managed.source, manifest, { masterKey: MASTER_KEY });

            for (const [rel, expected] of Object.entries(contents)) {
                const line = index.files.find((f) => f.p === rel)!;
                const actual = await readArchiveFile(managed.source, manifest, index, line, MASTER_KEY);
                expect(actual.equals(expected), rel).toBe(true);
            }
        } finally {
            await managed.dispose();
        }
    });
});
