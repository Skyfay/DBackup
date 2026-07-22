import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { extract } from "tar-stream";
import {
    createCombinedTar,
    extractCombinedArchive,
    readCombinedManifest,
    readManifestVersion,
    createMultiDbTar,
    isMultiDbTar,
    readTarManifest,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    DIRECTORY_INDEX_FILENAME,
} from "@/lib/adapters/database/common/tar-utils";
import type {
    CombinedTarFileEntry,
    DirectoryFileIndexEntry,
    DbEntryV2,
    DirectoryEntryV2,
} from "@/lib/adapters/database/common/types";

describe("Combined TAR utilities (manifest v2 - DB + directory sources)", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await createTempDir("test-combined-tar-");
    });

    afterEach(async () => {
        await cleanupTempDir(tempDir);
    });

    /** Writes `content` to a fresh local file under tempDir and returns its path. */
    async function writeLocalFile(name: string, content: string): Promise<string> {
        const filePath = path.join(tempDir, name);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        return filePath;
    }

    /** Builds a directory-source local root under tempDir containing the given relative files, returning a matching CombinedTarFileEntry. */
    async function makeDirectoryEntry(
        jobSourceId: string,
        label: string,
        files: Record<string, string>,
        excludePatterns: string[] = []
    ): Promise<CombinedTarFileEntry> {
        const localPath = path.join(tempDir, `dirsrc-${jobSourceId}`);
        await fs.mkdir(localPath, { recursive: true });
        const index: DirectoryFileIndexEntry[] = [];
        for (const [relPath, content] of Object.entries(files)) {
            const abs = path.join(localPath, relPath);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, content);
            index.push({ path: relPath, size: Buffer.byteLength(content), mtime: new Date("2026-01-01").toISOString() });
        }
        return { kind: "directory", jobSourceId, label, localPath, excludePatterns, files: index };
    }

    // ── createCombinedTar ────────────────────────────────────────────────

    describe("createCombinedTar", () => {
        it("creates a v2 archive with only database entries (multi-DB)", async () => {
            const db1 = await writeLocalFile("db1.sql", "-- db1 dump");
            const db2 = await writeLocalFile("db2.sql", "-- db2 dump");

            const entries: CombinedTarFileEntry[] = [
                { kind: "database", dbName: "shop", path: db1, format: "sql" },
                { kind: "database", dbName: "analytics", path: db2, format: "sql" },
            ];

            const tarPath = path.join(tempDir, "db-only.tar");
            const manifest = await createCombinedTar(entries, tarPath, { sourceType: "mysql", engineVersion: "8.0" });

            expect(manifest.version).toBe(2);
            expect(manifest.sourceType).toBe("mysql");
            expect(manifest.entries).toHaveLength(2);
            expect(manifest.entries.every((e) => e.kind === "database")).toBe(true);
            const shop = manifest.entries.find((e) => e.kind === "database" && e.name === "shop") as DbEntryV2;
            expect(shop.filename).toBe("databases/shop.sql");
            expect(manifest.totalSize).toBeGreaterThan(0);
        });

        it("creates a v2 archive with only directory entries", async () => {
            const dir = await makeDirectoryEntry("src-1", "SFTP: /data", {
                "a.txt": "AAAA",
                "sub/b.txt": "BBBBB",
            });

            const tarPath = path.join(tempDir, "dir-only.tar");
            const manifest = await createCombinedTar([dir], tarPath, { sourceType: "directory-only" });

            expect(manifest.version).toBe(2);
            expect(manifest.sourceType).toBe("directory-only");
            expect(manifest.entries).toHaveLength(1);
            const entry = manifest.entries[0] as DirectoryEntryV2;
            expect(entry.kind).toBe("directory");
            expect(entry.jobSourceId).toBe("src-1");
            expect(entry.pathPrefix).toBe("sources/src-1");
            expect(entry.fileCount).toBe(2);
            expect(entry.totalSize).toBe(9);
            // The manifest carries only the summary - never the full file list.
            expect((entry as unknown as { files?: unknown }).files).toBeUndefined();
        });

        it("creates a combined archive with both database and directory entries side by side", async () => {
            const db = await writeLocalFile("db.dump", "PGDMP content");
            const dir = await makeDirectoryEntry("src-1", "Local: /config", { "config.yml": "key: value" });

            const entries: CombinedTarFileEntry[] = [
                { kind: "database", dbName: "app", path: db, format: "custom" },
                dir,
            ];

            const tarPath = path.join(tempDir, "combined.tar");
            const manifest = await createCombinedTar(entries, tarPath, { sourceType: "postgres" });

            expect(manifest.entries).toHaveLength(2);
            expect(manifest.entries.map((e) => e.kind).sort()).toEqual(["database", "directory"]);
        });

        it("preserves excludePatterns in the directory entry's manifest metadata", async () => {
            const dir = await makeDirectoryEntry("src-1", "Local", { "keep.txt": "x" }, ["*.tmp", ".git/**"]);

            const tarPath = path.join(tempDir, "excl.tar");
            const manifest = await createCombinedTar([dir], tarPath, { sourceType: "directory-only" });

            const entry = manifest.entries[0] as DirectoryEntryV2;
            expect(entry.excludePatterns).toEqual(["*.tmp", ".git/**"]);
        });

        it("handles an empty directory source (0 files) without error", async () => {
            const dir = await makeDirectoryEntry("src-empty", "Empty dir", {});

            const tarPath = path.join(tempDir, "empty-dir.tar");
            const manifest = await createCombinedTar([dir], tarPath, { sourceType: "directory-only" });

            const entry = manifest.entries[0] as DirectoryEntryV2;
            expect(entry.fileCount).toBe(0);
            expect(entry.totalSize).toBe(0);
        });

        it("sets perEntryCompression on every archive, regardless of whether compression is requested", async () => {
            const db = await writeLocalFile("db.sql", "-- dump");
            const tarPath = path.join(tempDir, "no-compression.tar");
            const manifest = await createCombinedTar([{ kind: "database", dbName: "a", path: db, format: "sql" }], tarPath, { sourceType: "mysql" });

            expect(manifest.perEntryCompression).toBe(true);
            const entry = manifest.entries[0] as DbEntryV2;
            expect(entry.compressed).toBeUndefined();
        });

        it("compresses database entries per-entry when compression is requested", async () => {
            const content = "-- " + "x".repeat(2000);
            const db = await writeLocalFile("db.sql", content);
            const tarPath = path.join(tempDir, "db-gzip.tar");

            const manifest = await createCombinedTar(
                [{ kind: "database", dbName: "a", path: db, format: "sql" }],
                tarPath,
                { sourceType: "mysql", compression: "GZIP" }
            );

            const entry = manifest.entries[0] as DbEntryV2;
            expect(entry.compressed).toBe("GZIP");
            // Compressed size should be smaller than the (highly repetitive, easily compressible) original.
            expect(entry.size).toBeLessThan(Buffer.byteLength(content));
        });

        it("skips per-entry compression for database entries flagged nativeCompression", async () => {
            const content = "PGDMP " + "x".repeat(2000);
            const db = await writeLocalFile("db.dump", content);
            const tarPath = path.join(tempDir, "db-native.tar");

            const manifest = await createCombinedTar(
                [{ kind: "database", dbName: "a", path: db, format: "custom", nativeCompression: true }],
                tarPath,
                { sourceType: "postgres", compression: "GZIP" }
            );

            const entry = manifest.entries[0] as DbEntryV2;
            expect(entry.compressed).toBeUndefined();
            expect(entry.size).toBe(Buffer.byteLength(content));
        });

        it("compresses directory entries uniformly when compression is requested", async () => {
            const dir = await makeDirectoryEntry("src-1", "Local", { "a.txt": "a".repeat(2000) });
            const tarPath = path.join(tempDir, "dir-brotli.tar");

            const manifest = await createCombinedTar([dir], tarPath, { sourceType: "directory-only", compression: "BROTLI" });

            const entry = manifest.entries[0] as DirectoryEntryV2;
            expect(entry.compressed).toBe("BROTLI");
        });
    });

    // ── readManifestVersion / readCombinedManifest ──────────────────────

    describe("readManifestVersion", () => {
        it("returns 1 for a v1 (createMultiDbTar) archive", async () => {
            const file = await writeLocalFile("a.sql", "A");
            const tarPath = path.join(tempDir, "v1.tar");
            await createMultiDbTar([{ name: "a.sql", path: file, dbName: "a", format: "sql" }], tarPath, { sourceType: "mysql" });

            expect(await readManifestVersion(tarPath)).toBe(1);
        });

        it("returns 2 for a v2 (createCombinedTar) archive", async () => {
            const file = await writeLocalFile("a.sql", "A");
            const tarPath = path.join(tempDir, "v2.tar");
            await createCombinedTar([{ kind: "database", dbName: "a", path: file, format: "sql" }], tarPath, { sourceType: "mysql" });

            expect(await readManifestVersion(tarPath)).toBe(2);
        });

        it("returns null when no valid manifest is present", async () => {
            const invalidPath = path.join(tempDir, "invalid.tar");
            await fs.writeFile(invalidPath, "not a tar file");

            expect(await readManifestVersion(invalidPath)).toBeNull();
        });
    });

    describe("readCombinedManifest", () => {
        it("returns null (not the v1 shape) when given a v1 archive", async () => {
            const file = await writeLocalFile("a.sql", "A");
            const tarPath = path.join(tempDir, "v1-for-v2-reader.tar");
            await createMultiDbTar([{ name: "a.sql", path: file, dbName: "a", format: "sql" }], tarPath, { sourceType: "mysql" });

            expect(await readCombinedManifest(tarPath)).toBeNull();
        });

        it("returns the v2 manifest for a combined archive", async () => {
            const file = await writeLocalFile("a.sql", "A");
            const tarPath = path.join(tempDir, "v2-read.tar");
            await createCombinedTar([{ kind: "database", dbName: "a", path: file, format: "sql" }], tarPath, { sourceType: "mysql" });

            const manifest = await readCombinedManifest(tarPath);
            expect(manifest).not.toBeNull();
            expect(manifest!.version).toBe(2);
            expect(manifest!.entries).toHaveLength(1);
        });

        it("returns null for invalid TAR", async () => {
            const invalidPath = path.join(tempDir, "invalid2.tar");
            await fs.writeFile(invalidPath, "not a tar file");

            expect(await readCombinedManifest(invalidPath)).toBeNull();
        });
    });

    // ── extractCombinedArchive ───────────────────────────────────────────

    describe("extractCombinedArchive", () => {
        async function buildMultiEntryArchive() {
            const db1 = await writeLocalFile("db1.sql", "-- one");
            const db2 = await writeLocalFile("db2.sql", "-- two");
            const db3 = await writeLocalFile("db3.sql", "-- three");
            const dirA = await makeDirectoryEntry("dir-a", "Source A", { "a1.txt": "A1", "sub/a2.txt": "A2" });
            const dirB = await makeDirectoryEntry("dir-b", "Source B", { "b1.txt": "B1" });

            const entries: CombinedTarFileEntry[] = [
                { kind: "database", dbName: "one", path: db1, format: "sql" },
                { kind: "database", dbName: "two", path: db2, format: "sql" },
                { kind: "database", dbName: "three", path: db3, format: "sql" },
                dirA,
                dirB,
            ];

            const tarPath = path.join(tempDir, "multi-entry.tar");
            const manifest = await createCombinedTar(entries, tarPath, { sourceType: "mysql" });
            return { tarPath, manifest };
        }

        it("extracts every database and directory entry when no selection is given", async () => {
            const { tarPath } = await buildMultiEntryArchive();
            const extractDir = path.join(tempDir, "extract-all");

            const result = await extractCombinedArchive(tarPath, extractDir);

            expect(result.databaseFiles).toHaveLength(3);
            expect(result.directoryRoots).toHaveLength(2);

            const dirARoot = result.directoryRoots.find((r) => r.entry.jobSourceId === "dir-a")!.path;
            expect(await fs.readFile(path.join(dirARoot, "a1.txt"), "utf-8")).toBe("A1");
            expect(await fs.readFile(path.join(dirARoot, "sub/a2.txt"), "utf-8")).toBe("A2");

            // The per-file index metadata member must never be written as a restorable file.
            const indexExists = await fs
                .access(path.join(dirARoot, DIRECTORY_INDEX_FILENAME))
                .then(() => true)
                .catch(() => false);
            expect(indexExists).toBe(false);
        });

        it("extracts only the requested subset of databases (Multi-DB partial selection)", async () => {
            const { tarPath } = await buildMultiEntryArchive();
            const extractDir = path.join(tempDir, "extract-2dbs");

            const result = await extractCombinedArchive(tarPath, extractDir, { databaseNames: ["one", "three"] });

            expect(result.databaseFiles).toHaveLength(2);
            expect(result.databaseFiles.map((f) => f.entry.name).sort()).toEqual(["one", "three"]);
            expect(result.directoryRoots).toHaveLength(0);
        });

        it("extracts only the requested subset of directory sources", async () => {
            const { tarPath } = await buildMultiEntryArchive();
            const extractDir = path.join(tempDir, "extract-1dir");

            const result = await extractCombinedArchive(tarPath, extractDir, { directoryJobSourceIds: ["dir-b"] });

            expect(result.databaseFiles).toHaveLength(0);
            expect(result.directoryRoots).toHaveLength(1);
            expect(result.directoryRoots[0].entry.jobSourceId).toBe("dir-b");
            const root = result.directoryRoots[0].path;
            expect(await fs.readFile(path.join(root, "b1.txt"), "utf-8")).toBe("B1");
        });

        it("extracts a combination of selected databases and directories together", async () => {
            const { tarPath } = await buildMultiEntryArchive();
            const extractDir = path.join(tempDir, "extract-mixed");

            const result = await extractCombinedArchive(tarPath, extractDir, {
                databaseNames: ["two"],
                directoryJobSourceIds: ["dir-a"],
            });

            expect(result.databaseFiles).toHaveLength(1);
            expect(result.databaseFiles[0].entry.name).toBe("two");
            expect(result.directoryRoots).toHaveLength(1);

            expect(result.directoryRoots[0].entry.jobSourceId).toBe("dir-a");
        });

        it("transparently decompresses per-entry-compressed database and directory entries on extraction", async () => {
            const dbContent = "-- dump " + "y".repeat(500);
            const db = await writeLocalFile("db.sql", dbContent);
            const dir = await makeDirectoryEntry("src-1", "Local", { "file.txt": "file-content " + "z".repeat(500) });

            const entries: CombinedTarFileEntry[] = [
                { kind: "database", dbName: "a", path: db, format: "sql" },
                dir,
            ];

            const tarPath = path.join(tempDir, "compressed-roundtrip.tar");
            const manifest = await createCombinedTar(entries, tarPath, { sourceType: "mysql", compression: "GZIP" });
            expect((manifest.entries[0] as DbEntryV2).compressed).toBe("GZIP");
            expect((manifest.entries[1] as DirectoryEntryV2).compressed).toBe("GZIP");

            const extractDir = path.join(tempDir, "extract-compressed");
            const result = await extractCombinedArchive(tarPath, extractDir);

            expect(await fs.readFile(result.databaseFiles[0].path, "utf-8")).toBe(dbContent);
            const dirRoot = result.directoryRoots[0].path;
            expect(await fs.readFile(path.join(dirRoot, "file.txt"), "utf-8")).toBe("file-content " + "z".repeat(500));
        });

        it("compresses each file of a directory source individually (one tar member per file, not bundled)", async () => {
            const dir = await makeDirectoryEntry("src-multi", "Multi", {
                "a.txt": "a".repeat(300),
                "b.txt": "b".repeat(300),
                "nested/c.txt": "c".repeat(300),
            });

            const tarPath = path.join(tempDir, "dir-per-file.tar");
            const manifest = await createCombinedTar([dir], tarPath, { sourceType: "directory-only", compression: "GZIP" });
            const dirEntry = manifest.entries[0] as DirectoryEntryV2;
            expect(dirEntry.compressed).toBe("GZIP");

            // List raw tar member names - one member per file (plus the index), never a single bundle.
            const memberNames: string[] = [];
            await new Promise<void>((resolve, reject) => {
                const extractor = extract();
                extractor.on("entry", (header, stream, next) => {
                    memberNames.push(header.name);
                    stream.resume();
                    next();
                });
                extractor.on("finish", resolve);
                extractor.on("error", reject);
                createReadStream(tarPath).pipe(extractor);
            });
            const sourceMembers = memberNames.filter((n) => n.startsWith(`${dirEntry.pathPrefix}/`));
            expect(sourceMembers.sort()).toEqual([
                `${dirEntry.pathPrefix}/${DIRECTORY_INDEX_FILENAME}`,
                `${dirEntry.pathPrefix}/a.txt`,
                `${dirEntry.pathPrefix}/b.txt`,
                `${dirEntry.pathPrefix}/nested/c.txt`,
            ].sort());

            // Round-trip: every file (including the nested one) must still be individually restorable.
            const extractDir = path.join(tempDir, "extract-per-file");
            const result = await extractCombinedArchive(tarPath, extractDir);
            const root = result.directoryRoots[0].path;
            expect(await fs.readFile(path.join(root, "a.txt"), "utf-8")).toBe("a".repeat(300));
            expect(await fs.readFile(path.join(root, "b.txt"), "utf-8")).toBe("b".repeat(300));
            expect(await fs.readFile(path.join(root, "nested/c.txt"), "utf-8")).toBe("c".repeat(300));
        });

        it("extracts archives written before per-entry compression support unchanged (no `compressed`/`perEntryCompression` fields)", async () => {
            const dbContent = "-- legacy dump";
            const db = await writeLocalFile("legacy.sql", dbContent);
            const dir = await makeDirectoryEntry("src-legacy", "Legacy", { "legacy.txt": "legacy-content" });

            const tarPath = path.join(tempDir, "legacy.tar");
            // Simulates an archive from before this feature: no `compression` option passed, so
            // neither `perEntryCompression` nor any entry's `compressed` field gets set.
            await createCombinedTar(
                [{ kind: "database", dbName: "legacy", path: db, format: "sql" }, dir],
                tarPath,
                { sourceType: "mysql" }
            );

            const extractDir = path.join(tempDir, "extract-legacy");
            const result = await extractCombinedArchive(tarPath, extractDir);

            expect(await fs.readFile(result.databaseFiles[0].path, "utf-8")).toBe(dbContent);
            expect(await fs.readFile(path.join(result.directoryRoots[0].path, "legacy.txt"), "utf-8")).toBe("legacy-content");
        });

        it("treats an omitted field within a provided selection as 'none of this kind', not 'all'", async () => {
            const { tarPath } = await buildMultiEntryArchive();

            // Only databaseNames given - directoryJobSourceIds is entirely absent from the
            // selection object. This must NOT fall back to "all directories" - a two-dimensional
            // selection has to be explicit on both axes once any selection is provided at all.
            const dbOnlyResult = await extractCombinedArchive(
                tarPath,
                path.join(tempDir, "extract-db-only-field"),
                { databaseNames: ["one"] }
            );
            expect(dbOnlyResult.databaseFiles).toHaveLength(1);
            expect(dbOnlyResult.directoryRoots).toHaveLength(0);

            // Same in reverse: only directoryJobSourceIds given.
            const dirOnlyResult = await extractCombinedArchive(
                tarPath,
                path.join(tempDir, "extract-dir-only-field"),
                { directoryJobSourceIds: ["dir-a"] }
            );
            expect(dirOnlyResult.databaseFiles).toHaveLength(0);
            expect(dirOnlyResult.directoryRoots).toHaveLength(1);

            // An explicit empty array behaves the same as an omitted field (both mean "none").
            const explicitEmptyResult = await extractCombinedArchive(
                tarPath,
                path.join(tempDir, "extract-explicit-empty"),
                { databaseNames: [], directoryJobSourceIds: ["dir-b"] }
            );
            expect(explicitEmptyResult.databaseFiles).toHaveLength(0);
            expect(explicitEmptyResult.directoryRoots).toHaveLength(1);
        });

        it("lists an empty directory source as extracted (0 files) without writing the index as a file", async () => {
            const emptyDir = await makeDirectoryEntry("dir-empty", "Empty", {});
            const tarPath = path.join(tempDir, "empty-extract.tar");
            await createCombinedTar([emptyDir], tarPath, { sourceType: "directory-only" });

            const extractDir = path.join(tempDir, "extract-empty");
            const result = await extractCombinedArchive(tarPath, extractDir);

            expect(result.directoryRoots).toHaveLength(1);
            expect(result.directoryRoots[0].entry.fileCount).toBe(0);
            const rootContents = await fs.readdir(result.directoryRoots[0].path).catch(() => []);
            expect(rootContents).toEqual([]);
        });

        it("keeps a directory file whose relative path collides with a database's tar member name fully isolated (prefix isolation)", async () => {
            const dbFile = await writeLocalFile("evil.sql", "-- real database dump");
            // A directory source that happens to contain a file at the same relative path
            // a database entry's tar member would use ("databases/evil.sql").
            const trickyDir = await makeDirectoryEntry("dir-tricky", "Tricky", {
                "databases/evil.sql": "not a database - just a file that happens to be named like one",
            });

            const entries: CombinedTarFileEntry[] = [
                { kind: "database", dbName: "evil", path: dbFile, format: "sql" },
                trickyDir,
            ];
            const tarPath = path.join(tempDir, "collision.tar");
            await createCombinedTar(entries, tarPath, { sourceType: "mysql" });

            const extractDir = path.join(tempDir, "extract-collision");
            const result = await extractCombinedArchive(tarPath, extractDir);

            expect(result.databaseFiles).toHaveLength(1);
            const dbContent = await fs.readFile(result.databaseFiles[0].path, "utf-8");
            expect(dbContent).toBe("-- real database dump");

            const dirRoot = result.directoryRoots.find((r) => r.entry.jobSourceId === "dir-tricky")!.path;
            const trickyContent = await fs.readFile(path.join(dirRoot, "databases/evil.sql"), "utf-8");
            expect(trickyContent).toBe("not a database - just a file that happens to be named like one");

            // Neither file was overwritten by the other.
            expect(dbContent).not.toBe(trickyContent);
        });

        it("throws when the archive has no valid v2 manifest (e.g. a v1 archive)", async () => {
            const file = await writeLocalFile("a.sql", "A");
            const tarPath = path.join(tempDir, "v1-not-v2.tar");
            await createMultiDbTar([{ name: "a.sql", path: file, dbName: "a", format: "sql" }], tarPath, { sourceType: "mysql" });

            const extractDir = path.join(tempDir, "extract-fail");
            await expect(extractCombinedArchive(tarPath, extractDir)).rejects.toThrow(
                "does not contain a valid v2 manifest"
            );
        });

        it("rejects a maliciously crafted member name that attempts to escape the extraction directory", async () => {
            const { pack } = await import("tar-stream");
            const { createWriteStream } = await import("fs");
            const { pipeline } = await import("stream/promises");

            const tarPath = path.join(tempDir, "zip-slip.tar");
            const tarPack = pack();
            const outputStream = createWriteStream(tarPath);
            const pipePromise = pipeline(tarPack, outputStream);

            const manifest = {
                version: 2,
                createdAt: new Date().toISOString(),
                sourceType: "directory-only",
                entries: [
                    {
                        kind: "directory",
                        jobSourceId: "evil-src",
                        label: "Evil",
                        pathPrefix: "sources/evil-src",
                        fileCount: 1,
                        totalSize: 4,
                        excludePatterns: [],
                    },
                ],
                totalSize: 4,
            };
            const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf-8");
            tarPack.entry({ name: "manifest.json", size: manifestBuffer.length }).end(manifestBuffer);

            const evilBuffer = Buffer.from("evil", "utf-8");
            tarPack
                .entry({ name: "sources/evil-src/../../../../etc/evil", size: evilBuffer.length })
                .end(evilBuffer);

            tarPack.finalize();
            await pipePromise;

            const extractDir = path.join(tempDir, "extract-zip-slip");
            await expect(extractCombinedArchive(tarPath, extractDir)).rejects.toThrow("Zip Slip detected");
        });
    });

    // ── Backward compatibility: v1 archives/readers are untouched ───────

    describe("backward compatibility with v1 (pure multi-DB) archives", () => {
        it("isMultiDbTar/readTarManifest/extractSelectedDatabases still work unchanged on a v1 archive", async () => {
            const file1 = await writeLocalFile("db1.sql", "one");
            const file2 = await writeLocalFile("db2.sql", "two");
            const tarPath = path.join(tempDir, "still-v1.tar");
            await createMultiDbTar(
                [
                    { name: "db1.sql", path: file1, dbName: "one", format: "sql" },
                    { name: "db2.sql", path: file2, dbName: "two", format: "sql" },
                ],
                tarPath,
                { sourceType: "mysql" }
            );

            expect(await isMultiDbTar(tarPath)).toBe(true);

            const manifest = await readTarManifest(tarPath);
            expect(manifest!.version).toBe(1);
            expect(manifest!.databases).toHaveLength(2);

            const extractDir = path.join(tempDir, "v1-extract");
            const result = await extractSelectedDatabases(tarPath, extractDir, ["two"]);
            expect(result.files).toHaveLength(1);
            expect(await fs.readFile(result.files[0], "utf-8")).toBe("two");
        });
    });
});
