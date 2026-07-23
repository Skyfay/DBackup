/**
 * A failure mid-stream must reject the read, never take the process down.
 *
 * `openArchiveEntry`/`openArchiveFile` assemble a pipe chain (ranged read -> decrypt ->
 * decompress -> slice). A plain `.pipe()` does not forward an error from an intermediate
 * stage, so a corrupt or tampered archive would emit an unhandled 'error' and crash the
 * Node process - the worst outcome for a server that is in the middle of a restore. These
 * tests pin that a failure at any stage surfaces as a normal rejection instead.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Readable } from "stream";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveManifest, readArchiveIndex, readArchiveFile, openArchiveEntry, openArchiveFile } from "@/lib/archive/reader";
import { readAll } from "@/lib/archive/sources";
import { localFileSource } from "@/lib/archive/sources";
import type { ArchiveByteSource, ArchiveManifest, IndexEntryLine, ArchiveSourceEntry, SourceFileEntry } from "@/lib/archive/types";

const MASTER_KEY = Buffer.alloc(32, 0x5a);
let workDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-err-test-"));
});
afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

async function buildArchive(opts: { encrypted: boolean; compression: "NONE" | "GZIP" }) {
    const sourceDir = path.join(workDir, "src");
    await fs.mkdir(sourceDir, { recursive: true });

    const content = crypto.randomBytes(200_000); // above the bundling threshold: its own entry
    await fs.writeFile(path.join(sourceDir, "data.bin"), content);
    const files: SourceFileEntry[] = [{
        path: "data.bin",
        size: content.length,
        mtime: "2026-07-22T10:00:00.000Z",
        checksum: crypto.createHash("sha256").update(content).digest("hex"),
    }];

    const entries: ArchiveSourceEntry[] = [{
        kind: "directory", jobSourceId: "src-1", label: "Test", localPath: sourceDir, excludePatterns: [], files,
    }];

    const archivePath = path.join(workDir, "backup.tar");
    await createArchive(entries, archivePath, {
        sourceType: "directory-only",
        compression: opts.compression,
        ...(opts.encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: "p1" } } : {}),
    });
    return { archivePath, content };
}

/** Flips one byte inside the first data entry's payload, past the manifest. */
async function corruptPayload(archivePath: string) {
    const raw = await fs.readFile(archivePath);
    raw[Math.floor(raw.length * 0.6)] ^= 0xff;
    await fs.writeFile(archivePath, raw);
}

/**
 * A byte source whose stream errors partway through. This is the *first* element of the
 * pipe chain, so with a plain `.pipe()` its error is never forwarded to the returned tail -
 * the exact intermediate-stage crash the fix addresses. A downstream stage (the decompress
 * below) is what makes it an intermediate rather than the returned stream.
 */
function failingSource(): ArchiveByteSource {
    return {
        size: 1000,
        read: async () => {
            let pushed = false;
            return new Readable({
                read() {
                    if (!pushed) {
                        pushed = true;
                        this.push(Buffer.from([0x1f, 0x8b])); // gzip magic, so decompress starts
                        this.destroy(new Error("source read failed mid-stream"));
                    }
                },
            });
        },
    };
}

describe("openArchiveEntry - an upstream failure rejects instead of crashing", () => {
    it("surfaces a source error through a downstream stage on the returned stream", async () => {
        // The decisive case: the error is on a stage *before* the returned one. Under a
        // plain .pipe() chain this is the unhandled 'error' that takes the process down.
        const manifest = { version: 2, encryption: undefined } as unknown as ArchiveManifest;
        const entry = { n: 1, off: 0, size: 1000, comp: "GZIP" } as unknown as IndexEntryLine;

        const stream = await openArchiveEntry(failingSource(), manifest, entry);

        await expect(readAll(stream)).rejects.toThrow(/source read failed|incorrect header|unexpected end/i);
    });
});

describe("openArchiveEntry / openArchiveFile - mid-stream failures reject, not crash", () => {
    it("rejects when a sealed entry fails authentication (decrypt stage)", async () => {
        // The decrypt transform is an intermediate stage. Its error must reach the caller.
        const { archivePath } = await buildArchive({ encrypted: true, compression: "NONE" });
        await corruptPayload(archivePath);

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        const line = index.files.find((f) => f.p === "data.bin")!;

        await expect(readArchiveFile(source, manifest, index, line, MASTER_KEY))
            .rejects.toThrow();
    });

    it("rejects when decompression fails on corrupt bytes (decompress stage)", async () => {
        // Unencrypted so the corrupt bytes reach gunzip directly rather than failing the
        // AEAD tag first - this exercises the decompress stage specifically.
        const { archivePath } = await buildArchive({ encrypted: false, compression: "GZIP" });
        await corruptPayload(archivePath);

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest);
        const line = index.files.find((f) => f.p === "data.bin")!;

        await expect(readArchiveFile(source, manifest, index, line))
            .rejects.toThrow();
    });

    it("still returns the real bytes for an intact archive", async () => {
        // The guard must not have broken the happy path.
        const { archivePath, content } = await buildArchive({ encrypted: true, compression: "GZIP" });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        const line = index.files.find((f) => f.p === "data.bin")!;

        const bytes = await readAll(await openArchiveFile(source, manifest, index, line, MASTER_KEY));
        expect(bytes.equals(content)).toBe(true);
    });
});
