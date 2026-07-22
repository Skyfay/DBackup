import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { openStorageArchiveSource } from "@/lib/archive/storage-source";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveManifest, readArchiveIndex, readArchiveFile } from "@/lib/archive/reader";
import { readAll } from "@/lib/archive/sources";
import type { StorageAdapter } from "@/lib/core/interfaces";
import type { ArchiveSourceEntry } from "@/lib/archive/types";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const MASTER_KEY = Buffer.alloc(32, 0x7c);

let workDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-source-test-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

/** Adapter that serves ranges natively, like S3, SFTP or the local filesystem. */
function rangedAdapter(archivePath: string, calls: { ranges: [number, number][]; downloads: number }): StorageAdapter {
    return {
        id: "ranged", type: "storage", name: "Ranged", configSchema: {} as never,
        upload: vi.fn(), list: vi.fn(), delete: vi.fn(), test: vi.fn(),
        download: vi.fn(async () => { calls.downloads++; return true; }),
        downloadRange: async (_config: unknown, _remotePath: string, start: number, end: number) => {
            calls.ranges.push([start, end]);
            if (end < start) return Readable.from([]);
            return createReadStream(archivePath, { start, end });
        },
    } as unknown as StorageAdapter;
}

/** Adapter without range support, like Dropbox or FTP. */
function plainAdapter(archivePath: string, calls: { downloads: number }): StorageAdapter {
    return {
        id: "plain", type: "storage", name: "Plain", configSchema: {} as never,
        upload: vi.fn(), list: vi.fn(), delete: vi.fn(), test: vi.fn(),
        download: async (_config: unknown, _remotePath: string, localPath: unknown) => {
            calls.downloads++;
            await fs.copyFile(archivePath, localPath as string);
            return true;
        },
    } as unknown as StorageAdapter;
}

async function buildArchive(encrypted: boolean) {
    const sourceDir = path.join(workDir, "src");
    await fs.mkdir(sourceDir, { recursive: true });

    const contents: Record<string, Buffer> = {
        "www/index.php": Buffer.from("<?php echo 1; ?>\n".repeat(10)),
        "www/big.bin": crypto.randomBytes(300_000),
        "www/small.txt": Buffer.from("tiny"),
    };
    const files = [];
    for (const [rel, content] of Object.entries(contents)) {
        const target = path.join(sourceDir, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
        files.push({ path: rel, size: content.length, mtime: "2026-07-22T10:00:00.000Z" });
    }

    const entries: ArchiveSourceEntry[] = [{
        kind: "directory", jobSourceId: "src-1", label: "Test", localPath: sourceDir, excludePatterns: [], files,
    }];

    const archivePath = path.join(workDir, "backup.tar");
    await createArchive(entries, archivePath, {
        sourceType: "directory-only",
        compression: "GZIP",
        ...(encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: "p1" } } : {}),
    });

    return { archivePath, contents, size: (await fs.stat(archivePath)).size };
}

describe("openStorageArchiveSource", () => {
    it("serves entries by range without ever downloading the archive", async () => {
        const { archivePath, contents, size } = await buildArchive(true);
        const calls = { ranges: [] as [number, number][], downloads: 0 };
        const adapter = rangedAdapter(archivePath, calls);

        const managed = await openStorageArchiveSource(adapter, {} as never, "backup.tar", size);
        try {
            expect(managed.ranged).toBe(true);

            const manifest = await readArchiveManifest(managed.source);
            const index = await readArchiveIndex(managed.source, manifest, { masterKey: MASTER_KEY });

            for (const [rel, expected] of Object.entries(contents)) {
                const line = index.files.find((f) => f.p === rel)!;
                const actual = await readArchiveFile(managed.source, manifest, index, line, MASTER_KEY);
                expect(actual.equals(expected)).toBe(true);
            }

            expect(calls.downloads).toBe(0);
            // Every read stayed well inside the archive - no full-file transfer in disguise.
            expect(calls.ranges.length).toBeGreaterThan(0);
            for (const [start, end] of calls.ranges) {
                expect(start).toBeGreaterThanOrEqual(0);
                expect(end).toBeLessThan(size);
            }
        } finally {
            await managed.dispose();
        }
    });

    it("falls back to a single download for adapters without range support", async () => {
        const { archivePath, contents, size } = await buildArchive(true);
        const calls = { downloads: 0 };
        const adapter = plainAdapter(archivePath, calls);

        const managed = await openStorageArchiveSource(adapter, {} as never, "backup.tar", size);
        try {
            expect(managed.ranged).toBe(false);

            const manifest = await readArchiveManifest(managed.source);
            const index = await readArchiveIndex(managed.source, manifest, { masterKey: MASTER_KEY });

            for (const [rel, expected] of Object.entries(contents)) {
                const line = index.files.find((f) => f.p === rel)!;
                const actual = await readArchiveFile(managed.source, manifest, index, line, MASTER_KEY);
                expect(actual.equals(expected)).toBe(true);
            }

            // Downloaded once for the whole restore, not once per file.
            expect(calls.downloads).toBe(1);
        } finally {
            await managed.dispose();
        }
    });

    it("produces byte-identical results on both paths", async () => {
        const { archivePath, size } = await buildArchive(false);
        const ranged = await openStorageArchiveSource(
            rangedAdapter(archivePath, { ranges: [], downloads: 0 }), {} as never, "backup.tar", size
        );
        const plain = await openStorageArchiveSource(
            plainAdapter(archivePath, { downloads: 0 }), {} as never, "backup.tar", size
        );

        try {
            const manifestA = await readArchiveManifest(ranged.source);
            const manifestB = await readArchiveManifest(plain.source);
            expect(manifestA).toEqual(manifestB);

            const indexA = await readArchiveIndex(ranged.source, manifestA);
            const indexB = await readArchiveIndex(plain.source, manifestB);

            for (const line of indexA.files) {
                const a = await readArchiveFile(ranged.source, manifestA, indexA, line);
                const b = await readArchiveFile(plain.source, manifestB, indexB, indexB.files.find((f) => f.p === line.p)!);
                expect(a.equals(b)).toBe(true);
            }
        } finally {
            await ranged.dispose();
            await plain.dispose();
        }
    });

    it("removes its temp file on dispose", async () => {
        const { archivePath, size } = await buildArchive(false);
        const managed = await openStorageArchiveSource(
            plainAdapter(archivePath, { downloads: 0 }), {} as never, "backup.tar", size
        );

        // Reading works before dispose and the bytes come from a real temp file.
        expect((await readAll(await managed.source.read(0, 511))).length).toBe(512);
        await managed.dispose();

        await expect(managed.source.read(0, 511).then(readAll)).rejects.toThrow();
    });

    it("surfaces a failed download instead of returning an empty source", async () => {
        const adapter = {
            id: "broken", type: "storage", name: "Broken", configSchema: {} as never,
            upload: vi.fn(), list: vi.fn(), delete: vi.fn(), test: vi.fn(),
            download: async () => false,
        } as unknown as StorageAdapter;

        await expect(openStorageArchiveSource(adapter, {} as never, "backup.tar", 10))
            .rejects.toThrow(/failed to download archive/i);
    });
});
