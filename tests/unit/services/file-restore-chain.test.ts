import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Readable } from "stream";
import { createReadStream, existsSync } from "fs";
import { extract } from "tar-stream";
import { createGunzip } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import { carryForward, fileKey } from "@/lib/archive/chain";
import type { ArchiveSourceEntry, SourceFileEntry } from "@/lib/archive/types";
import type { StorageAdapter } from "@/lib/core/interfaces";

const MASTER_KEY = Buffer.alloc(32, 0x9c);
const SRC = "src-1";
const JOB_DIR = "plex/chain-2026-07-15";

const prismaMock = {
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: async () => MASTER_KEY }));

const { streamFileRestore } = await import("@/services/restore/file-restore");

let workDir: string;
/** Files currently materialised on local disk by the non-ranged adapter. */
let onDisk: Set<string>;
let peakOnDisk: number;

/**
 * Storage adapter WITHOUT ranged reads, i.e. the Dropbox/SMB case.
 *
 * It tracks how many archives are simultaneously staged on disk, which is the property
 * the chain reader has to bound - visiting files in selection order rather than grouped
 * by archive would hold the whole chain at once.
 */
function makeNonRangedAdapter(): StorageAdapter {
    return {
        id: "plain", type: "storage", name: "Plain", configSchema: {} as never,
        list: async (_c: unknown, dir: string) => {
            const names = await fs.readdir(path.join(workDir, dir));
            return names.map((n) => ({ name: n, path: `${dir}/${n}`, size: 0, lastModified: new Date() }));
        },
        delete: vi.fn(), test: vi.fn(), upload: vi.fn(),
        read: async (_c: unknown, remotePath: string) =>
            remotePath.endsWith(".meta.json") ? await fs.readFile(path.join(workDir, remotePath), "utf-8") : null,
        download: async (_c: unknown, remotePath: string, localPath: string) => {
            await fs.copyFile(path.join(workDir, remotePath), localPath);
            // Only whole archives matter here. The tiny .index sidecar is fetched to a
            // temp file by design and is not what the peak-disk bound is about.
            if (!remotePath.endsWith(".tar")) return true;

            // Measured against the real filesystem rather than by watching dispose(), so
            // the count is exact at the moment a new archive lands.
            for (const tracked of [...onDisk]) {
                if (!existsSync(tracked)) onDisk.delete(tracked);
            }
            onDisk.add(localPath);
            peakOnDisk = Math.max(peakOnDisk, onDisk.size);
            return true;
        },
    } as unknown as StorageAdapter;
}

/** Adapter WITH ranged reads, i.e. the S3/SFTP case. */
function makeRangedAdapter(rangeCount: { n: number }): StorageAdapter {
    const base = makeNonRangedAdapter();
    return {
        ...base,
        id: "ranged",
        downloadRange: async (_c: unknown, remotePath: string, start: number, end: number) => {
            rangeCount.n++;
            if (end < start) return Readable.from([]);
            return createReadStream(path.join(workDir, remotePath), { start, end });
        },
    } as unknown as StorageAdapter;
}

async function writeMeta(archiveName: string, indexBytes: Buffer, kdfSalt: string, noncePrefix: string) {
    await fs.writeFile(path.join(workDir, JOB_DIR, `${archiveName}.index`), indexBytes);
    await fs.writeFile(path.join(workDir, JOB_DIR, `${archiveName}.meta.json`), JSON.stringify({
        version: 1,
        archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "p1", kdfSalt, noncePrefix },
    }));
}

/**
 * Builds a three-archive chain:
 *   full-1  stores a.bin, b.bin, big.bin
 *   inc-2   changes b.bin, carries a.bin and big.bin from full-1
 *   inc-3   changes a.bin, carries b.bin from inc-2 and big.bin from full-1
 */
async function buildChain() {
    const contents = {
        v1: {
            "a.bin": crypto.randomBytes(3000),
            "b.bin": crypto.randomBytes(3000),
            "big.bin": crypto.randomBytes(200_000),
        },
        b2: crypto.randomBytes(4000),
        a3: crypto.randomBytes(5000),
    };

    const stage = async (files: Record<string, Buffer>) => {
        const dir = path.join(workDir, `stage-${crypto.randomUUID()}`);
        await fs.mkdir(dir, { recursive: true });
        const entries: SourceFileEntry[] = [];
        for (const [rel, content] of Object.entries(files)) {
            await fs.writeFile(path.join(dir, rel), content);
            entries.push({
                path: rel, size: content.length, mtime: "2026-07-22T10:00:00.000Z",
                checksum: crypto.createHash("sha256").update(content).digest("hex"),
            });
        }
        return { dir, entries };
    };

    const source = (dir: string, files: SourceFileEntry[]): ArchiveSourceEntry[] => [
        { kind: "directory", jobSourceId: SRC, label: "Plex", localPath: dir, excludePatterns: [], files },
    ];
    const encryption = { masterKey: MASTER_KEY, profileId: "p1" };

    // ── full-1 ──
    const s1 = await stage(contents.v1);
    const full = await createArchive(source(s1.dir, s1.entries), path.join(workDir, JOB_DIR, "full-1.tar"), {
        sourceType: "directory-only", compression: "GZIP", encryption,
        chain: { id: "c1", type: "full", index: 0 },
    });
    await writeMeta("full-1.tar", full.indexBytes, full.manifest.encryption!.kdfSalt, full.manifest.encryption!.noncePrefix);

    // ── inc-2: only b.bin changed ──
    const s2 = await stage({ "b.bin": contents.b2 });
    const inc2 = await createArchive(source(s2.dir, s2.entries), path.join(workDir, JOB_DIR, "inc-2.tar"), {
        sourceType: "directory-only", compression: "GZIP", encryption,
        chain: {
            id: "c1", type: "incremental", base: "full-1.tar", index: 1,
            carried: carryForward(full.index, "full-1.tar", new Set([fileKey(SRC, "a.bin"), fileKey(SRC, "big.bin")])),
        },
    });
    await writeMeta("inc-2.tar", inc2.indexBytes, inc2.manifest.encryption!.kdfSalt, inc2.manifest.encryption!.noncePrefix);

    // ── inc-3: only a.bin changed ──
    const s3 = await stage({ "a.bin": contents.a3 });
    const inc3 = await createArchive(source(s3.dir, s3.entries), path.join(workDir, JOB_DIR, "inc-3.tar"), {
        sourceType: "directory-only", compression: "GZIP", encryption,
        chain: {
            id: "c1", type: "incremental", base: "inc-2.tar", index: 2,
            carried: carryForward(inc2.index, "inc-2.tar", new Set([fileKey(SRC, "b.bin"), fileKey(SRC, "big.bin")])),
        },
    });
    await writeMeta("inc-3.tar", inc3.indexBytes, inc3.manifest.encryption!.kdfSalt, inc3.manifest.encryption!.noncePrefix);

    return {
        expectedAtSnapshot3: { "a.bin": contents.a3, "b.bin": contents.b2, "big.bin": contents.v1["big.bin"] },
        expectedAtSnapshot1: contents.v1,
    };
}

async function readTarGz(stream: NodeJS.ReadableStream): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    await new Promise<void>((resolve, reject) => {
        const extractor = extract();
        extractor.on("entry", (header, entryStream, next) => {
            const chunks: Buffer[] = [];
            entryStream.on("data", (c: Buffer) => chunks.push(c));
            entryStream.on("end", () => { out.set(header.name, Buffer.concat(chunks)); next(); });
            entryStream.on("error", reject);
        });
        extractor.on("finish", () => resolve());
        extractor.on("error", reject);
        stream.pipe(createGunzip()).pipe(extractor);
    });
    return out;
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "chain-restore-test-"));
    await fs.mkdir(path.join(workDir, JOB_DIR), { recursive: true });
    onDisk = new Set();
    peakOnDisk = 0;
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1", type: "storage", adapterId: "plain", name: "Plain", config: "{}",
    });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

const restoreInput = (archive: string) => ({
    storageConfigId: "storage-1",
    file: `${JOB_DIR}/${archive}`,
    selections: [{ src: SRC, paths: ["a.bin", "b.bin", "big.bin"] }],
    target: { kind: "download" as const },
});

describe("restoring a snapshot from an incremental chain", () => {
    it("assembles the latest snapshot from all three archives", async () => {
        const { expectedAtSnapshot3 } = await buildChain();
        registryGet.mockReturnValue(makeNonRangedAdapter());

        const files = await readTarGz(await streamFileRestore(restoreInput("inc-3.tar")));

        for (const [rel, expected] of Object.entries(expectedAtSnapshot3)) {
            expect(files.get(`${SRC}/${rel}`)!.equals(expected), rel).toBe(true);
        }
    });

    it("restores an older snapshot as it was at the time, not as it is now", async () => {
        const { expectedAtSnapshot1 } = await buildChain();
        registryGet.mockReturnValue(makeNonRangedAdapter());

        const files = await readTarGz(await streamFileRestore(restoreInput("full-1.tar")));

        for (const [rel, expected] of Object.entries(expectedAtSnapshot1)) {
            expect(files.get(`${SRC}/${rel}`)!.equals(expected), rel).toBe(true);
        }
    });

    it("never holds more than two archives on disk at once", async () => {
        await buildChain();
        registryGet.mockReturnValue(makeNonRangedAdapter());

        await readTarGz(await streamFileRestore(restoreInput("inc-3.tar")));

        // Snapshot archive plus at most one sibling. Without grouping the work by archive
        // this would be the whole chain, which for a real backup means running out of disk.
        expect(peakOnDisk).toBeLessThanOrEqual(2);
    });

    it("uses ranged reads and never downloads an archive when the adapter supports them", async () => {
        const { expectedAtSnapshot3 } = await buildChain();
        const rangeCount = { n: 0 };
        registryGet.mockReturnValue(makeRangedAdapter(rangeCount));

        const files = await readTarGz(await streamFileRestore(restoreInput("inc-3.tar")));

        expect(files.get(`${SRC}/big.bin`)!.equals(expectedAtSnapshot3["big.bin"])).toBe(true);
        expect(rangeCount.n).toBeGreaterThan(0);
        expect(peakOnDisk).toBe(0);
    });

    it("refuses the restore by name when an archive of the chain is missing", async () => {
        await buildChain();
        await fs.unlink(path.join(workDir, JOB_DIR, "full-1.tar"));
        registryGet.mockReturnValue(makeNonRangedAdapter());

        await expect(streamFileRestore(restoreInput("inc-3.tar")))
            .rejects.toThrow(/incremental chain[\s\S]*full-1\.tar/);
    });
});
