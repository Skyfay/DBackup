import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
    createMultiDbTar,
    extractMultiDbTar,
    extractSelectedDatabases,
    isMultiDbTar,
    readTarManifest,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "@/lib/adapters/database/common/tar-utils";
import type { TarFileEntry } from "@/lib/adapters/database/common/types";

describe("TAR Utils for Multi-DB Backups", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await createTempDir("test-tar-");
    });

    afterEach(async () => {
        await cleanupTempDir(tempDir);
    });

    describe("createTempDir / cleanupTempDir", () => {
        it("should create a temporary directory", async () => {
            const dir = await createTempDir("unit-test-");
            const exists = await fs
                .access(dir)
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(true);
            await cleanupTempDir(dir);
        });

        it("should cleanup temporary directory", async () => {
            const dir = await createTempDir("cleanup-test-");
            await fs.writeFile(path.join(dir, "test.txt"), "content");
            await cleanupTempDir(dir);
            const exists = await fs
                .access(dir)
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(false);
        });
    });

    describe("createMultiDbTar", () => {
        it("should create a TAR archive with manifest and files", async () => {
            // Create test files
            const file1Path = path.join(tempDir, "db1.sql");
            const file2Path = path.join(tempDir, "db2.sql");
            await fs.writeFile(file1Path, "-- Database 1 dump\nCREATE TABLE test1;");
            await fs.writeFile(file2Path, "-- Database 2 dump\nCREATE TABLE test2;");

            const files: TarFileEntry[] = [
                { name: "db1.sql", path: file1Path, dbName: "database1", format: "sql" },
                { name: "db2.sql", path: file2Path, dbName: "database2", format: "sql" },
            ];

            const tarPath = path.join(tempDir, "backup.tar");
            const manifest = await createMultiDbTar(files, tarPath, {
                sourceType: "mysql",
                engineVersion: "8.0.32",
            });

            // Verify manifest
            expect(manifest.version).toBe(1);
            expect(manifest.sourceType).toBe("mysql");
            expect(manifest.engineVersion).toBe("8.0.32");
            expect(manifest.databases).toHaveLength(2);
            expect(manifest.databases[0].name).toBe("database1");
            expect(manifest.databases[1].name).toBe("database2");
            expect(manifest.totalSize).toBeGreaterThan(0);

            // Verify TAR file was created
            const tarStats = await fs.stat(tarPath);
            expect(tarStats.size).toBeGreaterThan(0);
        });

        it("should include correct database entries in manifest", async () => {
            const filePath = path.join(tempDir, "testdb.dump");
            await fs.writeFile(filePath, "PGDMP test content for postgres");

            const files: TarFileEntry[] = [
                { name: "testdb.dump", path: filePath, dbName: "testdb", format: "custom" },
            ];

            const tarPath = path.join(tempDir, "pg-backup.tar");
            const manifest = await createMultiDbTar(files, tarPath, {
                sourceType: "postgresql",
                engineVersion: "15.2",
            });

            expect(manifest.databases[0]).toEqual({
                name: "testdb",
                filename: "testdb.dump",
                size: expect.any(Number),
                format: "custom",
            });
        });
    });

    describe("extractMultiDbTar", () => {
        it("should extract TAR archive and return manifest + files", async () => {
            // Create a TAR archive first
            const file1Path = path.join(tempDir, "source_db1.sql");
            await fs.writeFile(file1Path, "SELECT 1;");

            const files: TarFileEntry[] = [
                { name: "db1.sql", path: file1Path, dbName: "mydb", format: "sql" },
            ];

            const tarPath = path.join(tempDir, "test-extract.tar");
            await createMultiDbTar(files, tarPath, { sourceType: "mysql" });

            // Extract to a different directory
            const extractDir = path.join(tempDir, "extracted");
            const result = await extractMultiDbTar(tarPath, extractDir);

            expect(result.manifest.version).toBe(1);
            expect(result.manifest.databases).toHaveLength(1);
            expect(result.files).toHaveLength(1);
            expect(result.files[0]).toContain("db1.sql");

            // Verify extracted file content
            const extractedContent = await fs.readFile(result.files[0], "utf-8");
            expect(extractedContent).toBe("SELECT 1;");
        });

        it("should throw error if manifest is missing", async () => {
            // Create a TAR without manifest (raw tar)
            const { pack } = await import("tar-stream");
            const { createWriteStream } = await import("fs");
            const { pipeline } = await import("stream/promises");

            const tarPath = path.join(tempDir, "no-manifest.tar");
            const tarPack = pack();
            const outputStream = createWriteStream(tarPath);
            const pipePromise = pipeline(tarPack, outputStream);

            const entry = tarPack.entry({ name: "random.txt", size: 4 });
            entry.end("test");
            tarPack.finalize();
            await pipePromise;

            const extractDir = path.join(tempDir, "extract-fail");
            await expect(extractMultiDbTar(tarPath, extractDir)).rejects.toThrow(
                "TAR archive does not contain a manifest.json"
            );
        });
    });

    describe("isMultiDbTar", () => {
        it("should return true for valid Multi-DB TAR archive", async () => {
            const filePath = path.join(tempDir, "test.sql");
            await fs.writeFile(filePath, "test content");

            const tarPath = path.join(tempDir, "valid.tar");
            await createMultiDbTar(
                [{ name: "test.sql", path: filePath, dbName: "test", format: "sql" }],
                tarPath,
                { sourceType: "mysql" }
            );

            expect(await isMultiDbTar(tarPath)).toBe(true);
        });

        it("should return false for non-existent file", async () => {
            expect(await isMultiDbTar("/nonexistent/file.tar")).toBe(false);
        });

        it("should return false for regular SQL file", async () => {
            const sqlPath = path.join(tempDir, "backup.sql");
            await fs.writeFile(sqlPath, "CREATE TABLE test;");
            expect(await isMultiDbTar(sqlPath)).toBe(false);
        });

        it("should return false for TAR without manifest", async () => {
            const { pack } = await import("tar-stream");
            const { createWriteStream } = await import("fs");
            const { pipeline } = await import("stream/promises");

            const tarPath = path.join(tempDir, "no-manifest.tar");
            const tarPack = pack();
            const outputStream = createWriteStream(tarPath);
            const pipePromise = pipeline(tarPack, outputStream);

            const entry = tarPack.entry({ name: "data.bak", size: 4 });
            entry.end("test");
            tarPack.finalize();
            await pipePromise;

            expect(await isMultiDbTar(tarPath)).toBe(false);
        });
    });

    describe("readTarManifest", () => {
        it("should read manifest without extracting other files", async () => {
            const filePath = path.join(tempDir, "large.sql");
            // Create a "large" file
            await fs.writeFile(filePath, "X".repeat(10000));

            const tarPath = path.join(tempDir, "manifest-read.tar");
            await createMultiDbTar(
                [{ name: "large.sql", path: filePath, dbName: "bigdb", format: "sql" }],
                tarPath,
                { sourceType: "mysql", engineVersion: "5.7.42" }
            );

            const manifest = await readTarManifest(tarPath);

            expect(manifest).not.toBeNull();
            expect(manifest!.version).toBe(1);
            expect(manifest!.sourceType).toBe("mysql");
            expect(manifest!.engineVersion).toBe("5.7.42");
            expect(manifest!.databases[0].name).toBe("bigdb");
        });

        it("should return null for invalid TAR", async () => {
            const invalidPath = path.join(tempDir, "invalid.tar");
            await fs.writeFile(invalidPath, "not a tar file");

            const manifest = await readTarManifest(invalidPath);
            expect(manifest).toBeNull();
        });
    });

    describe("shouldRestoreDatabase", () => {
        it("should return true when no mapping provided", () => {
            expect(shouldRestoreDatabase("anydb")).toBe(true);
            expect(shouldRestoreDatabase("anydb", [])).toBe(true);
        });

        it("should return true for selected databases", () => {
            const mapping = [
                { originalName: "db1", targetName: "db1_copy", selected: true },
                { originalName: "db2", targetName: "db2_copy", selected: false },
            ];

            expect(shouldRestoreDatabase("db1", mapping)).toBe(true);
            expect(shouldRestoreDatabase("db2", mapping)).toBe(false);
        });

        it("should return false for unknown databases when mapping exists", () => {
            const mapping = [
                { originalName: "db1", targetName: "db1", selected: true },
            ];

            expect(shouldRestoreDatabase("unknown", mapping)).toBe(false);
        });
    });

    describe("getTargetDatabaseName", () => {
        it("should return original name when no mapping provided", () => {
            expect(getTargetDatabaseName("mydb")).toBe("mydb");
            expect(getTargetDatabaseName("mydb", [])).toBe("mydb");
        });

        it("should return target name from mapping", () => {
            const mapping = [
                { originalName: "production", targetName: "staging", selected: true },
            ];

            expect(getTargetDatabaseName("production", mapping)).toBe("staging");
        });

        it("should return original name if not in mapping", () => {
            const mapping = [
                { originalName: "db1", targetName: "db1_copy", selected: true },
            ];

            expect(getTargetDatabaseName("unknown", mapping)).toBe("unknown");
        });
    });

    describe("extractSelectedDatabases", () => {
        it("should extract only selected databases from TAR archive", async () => {
            // Create a TAR with 3 databases
            const file1 = path.join(tempDir, "db1.sql");
            const file2 = path.join(tempDir, "db2.sql");
            const file3 = path.join(tempDir, "db3.sql");
            await fs.writeFile(file1, "-- DB1 dump\nCREATE TABLE t1;");
            await fs.writeFile(file2, "-- DB2 dump\nCREATE TABLE t2;");
            await fs.writeFile(file3, "-- DB3 dump\nCREATE TABLE t3;");

            const files: TarFileEntry[] = [
                { name: "db1.sql", path: file1, dbName: "database1", format: "sql" },
                { name: "db2.sql", path: file2, dbName: "database2", format: "sql" },
                { name: "db3.sql", path: file3, dbName: "database3", format: "sql" },
            ];

            const tarPath = path.join(tempDir, "multi.tar");
            await createMultiDbTar(files, tarPath, { sourceType: "mysql" });

            // Extract only database2
            const extractDir = path.join(tempDir, "selective");
            const result = await extractSelectedDatabases(tarPath, extractDir, ["database2"]);

            // Manifest should still contain all 3 databases
            expect(result.manifest.databases).toHaveLength(3);
            // But only 1 file should be extracted
            expect(result.files).toHaveLength(1);
            expect(result.files[0]).toContain("db2.sql");

            // Verify only the selected file exists on disk
            const dirContents = await fs.readdir(extractDir);
            expect(dirContents).toEqual(["db2.sql"]);

            // Verify content is correct
            const content = await fs.readFile(result.files[0], "utf-8");
            expect(content).toBe("-- DB2 dump\nCREATE TABLE t2;");
        });

        it("should extract all databases when selectedNames is empty", async () => {
            const file1 = path.join(tempDir, "a.sql");
            const file2 = path.join(tempDir, "b.sql");
            await fs.writeFile(file1, "A");
            await fs.writeFile(file2, "B");

            const files: TarFileEntry[] = [
                { name: "a.sql", path: file1, dbName: "alpha", format: "sql" },
                { name: "b.sql", path: file2, dbName: "beta", format: "sql" },
            ];

            const tarPath = path.join(tempDir, "all.tar");
            await createMultiDbTar(files, tarPath, { sourceType: "mysql" });

            const extractDir = path.join(tempDir, "all-extract");
            const result = await extractSelectedDatabases(tarPath, extractDir, []);

            expect(result.files).toHaveLength(2);
        });

        it("should extract multiple selected databases", async () => {
            const file1 = path.join(tempDir, "d1.sql");
            const file2 = path.join(tempDir, "d2.sql");
            const file3 = path.join(tempDir, "d3.sql");
            await fs.writeFile(file1, "1");
            await fs.writeFile(file2, "2");
            await fs.writeFile(file3, "3");

            const files: TarFileEntry[] = [
                { name: "d1.sql", path: file1, dbName: "one", format: "sql" },
                { name: "d2.sql", path: file2, dbName: "two", format: "sql" },
                { name: "d3.sql", path: file3, dbName: "three", format: "sql" },
            ];

            const tarPath = path.join(tempDir, "pick2.tar");
            await createMultiDbTar(files, tarPath, { sourceType: "postgresql" });

            const extractDir = path.join(tempDir, "pick2-extract");
            const result = await extractSelectedDatabases(tarPath, extractDir, ["one", "three"]);

            expect(result.files).toHaveLength(2);
            const basenames = result.files.map(f => path.basename(f)).sort();
            expect(basenames).toEqual(["d1.sql", "d3.sql"]);
        });

        it("should throw error if TAR has no manifest", async () => {
            const { pack } = await import("tar-stream");
            const { createWriteStream } = await import("fs");
            const { pipeline } = await import("stream/promises");

            const tarPath = path.join(tempDir, "no-manifest-sel.tar");
            const tarPack = pack();
            const outputStream = createWriteStream(tarPath);
            const pipePromise = pipeline(tarPack, outputStream);

            const entry = tarPack.entry({ name: "random.txt", size: 4 });
            entry.end("test");
            tarPack.finalize();
            await pipePromise;

            const extractDir = path.join(tempDir, "sel-fail");
            await expect(
                extractSelectedDatabases(tarPath, extractDir, ["anything"])
            ).rejects.toThrow("TAR archive does not contain a manifest.json");
        });
    });
});
