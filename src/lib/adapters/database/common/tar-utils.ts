/**
 * TAR Archive Utilities for Multi-DB Backups (manifest v1)
 *
 * The format database-only jobs wrote before every backup became a seekable v2 archive (see
 * src/lib/archive/). No job writes it anymore, but backups in it stay restorable, and every
 * adapter's restore() reads them through the helpers here. The restore pipeline tells the two
 * apart from the backup's metadata, and refuses a v2 manifest that reaches the v1 path.
 *
 * LEGACY-FORMAT(read): Everything in this file serves the older format, except createTempDir,
 * cleanupTempDir, shouldRestoreDatabase and getTargetDatabaseName, which the seekable archive
 * uses too. Move those four elsewhere before deleting the file.
 */

import { createReadStream, createWriteStream, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { pack, extract } from "tar-stream";
import { pipeline } from "stream/promises";
import { getTempDir } from "@/lib/temp-dir";
import { assertPlainFileName } from "@/lib/archive/dump-names";
import { DamagedBackupError } from "@/lib/archive/limits";
import {
    TarManifest,
    TarFileEntry,
    ExtractResult,
    CreateTarOptions,
    DatabaseEntry,
} from "./types";

/** Manifest filename inside the TAR archive */
export const MANIFEST_FILENAME = "manifest.json";

/**
 * Create a TAR archive containing multiple database dumps
 *
 * @param files - Array of files to include in the archive
 * @param destinationPath - Path where the TAR archive will be created
 * @param options - Options including sourceType and engineVersion
 * @returns The created manifest
 */
// LEGACY-FORMAT(write): Builds the multi-database TAR no job writes anymore. The adapters' dump()
// and the tests that need an older backup as a fixture still use it. Keep a copy for those tests
// until the read side is removed too.
export async function createMultiDbTar(
    files: TarFileEntry[],
    destinationPath: string,
    options: CreateTarOptions
): Promise<TarManifest> {
    const tarPack = pack();
    const outputStream = createWriteStream(destinationPath);

    // Start the pipeline
    const pipelinePromise = pipeline(tarPack, outputStream);

    // Build database entries and calculate total size
    const databases: DatabaseEntry[] = [];
    let totalSize = 0;

    for (const file of files) {
        const stats = await fs.stat(file.path);
        databases.push({
            name: file.dbName,
            filename: file.name,
            size: stats.size,
            format: file.format,
        });
        totalSize += stats.size;
    }

    // Create manifest
    const manifest: TarManifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        sourceType: options.sourceType,
        engineVersion: options.engineVersion,
        databases,
        totalSize,
    };

    // Add manifest.json as first entry
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestBuffer = Buffer.from(manifestJson, "utf-8");

    const manifestEntry = tarPack.entry({
        name: MANIFEST_FILENAME,
        size: manifestBuffer.length,
    });
    manifestEntry.end(manifestBuffer);

    // Add each database dump file
    for (const file of files) {
        const fileStats = await fs.stat(file.path);

        // Create entry header
        const entry = tarPack.entry({
            name: file.name,
            size: fileStats.size,
        });

        // Stream file contents to tar entry
        const fileStream = createReadStream(file.path);
        await new Promise<void>((resolve, reject) => {
            fileStream.on("error", (err) => {
                fileStream.destroy();
                reject(err);
            });
            fileStream.on("end", () => {
                entry.end();
                resolve();
            });
            fileStream.pipe(entry);
        });
    }

    // Finalize the archive
    tarPack.finalize();
    await pipelinePromise;

    return manifest;
}

/**
 * Extract only selected databases from a Multi-DB TAR archive
 *
 * Instead of extracting all entries, this function reads the manifest first
 * and only writes files matching the selected database names to disk.
 * Unselected entries are skipped via stream.resume() without I/O.
 *
 * @param sourcePath - Path to the TAR archive
 * @param extractDir - Directory to extract files into
 * @param selectedNames - Database names to extract (from manifest). If empty, extracts all.
 * @returns The manifest and list of extracted file paths
 */
export async function extractSelectedDatabases(
    sourcePath: string,
    extractDir: string,
    selectedNames: string[]
): Promise<ExtractResult> {
    // Ensure extract directory exists
    await fs.mkdir(extractDir, { recursive: true });

    // Read manifest first to build a lookup of filename → dbName
    const manifest = await readTarManifest(sourcePath);
    if (!manifest) {
        throw new Error("TAR archive does not contain a manifest.json");
    }
    // The callers find the dump of a database by its `filename` among the files written here,
    // so a name that is no plain file name is refused before anything is written.
    assertManifestFileNames(manifest);

    // Build a Set of filenames that belong to selected databases
    const selectedFilenames = new Set<string>();
    for (const db of manifest.databases) {
        if (selectedNames.length === 0 || selectedNames.includes(db.name)) {
            selectedFilenames.add(db.filename);
        }
    }

    const extractedFiles: string[] = [];

    return new Promise((resolve, reject) => {
        const extractor = extract();
        const readStream = createReadStream(sourcePath);
        const fail = (err: unknown) => {
            readStream.destroy();
            extractor.destroy();
            reject(err);
        };

        extractor.on("entry", (header, stream, next) => {
            // Skip manifest (already parsed) and non-selected files
            if (header.name === MANIFEST_FILENAME || !selectedFilenames.has(header.name)) {
                stream.resume();
                next();
                return;
            }

            // Write selected database dump file. `wx` refuses a second member of the same
            // name instead of following or overwriting what the first one left.
            let outputPath: string;
            try {
                outputPath = memberTarget(extractDir, header);
            } catch (err) {
                fail(err);
                return;
            }
            const writeStream = createWriteStream(outputPath, { flags: "wx" });

            writeStream.on("finish", () => {
                extractedFiles.push(outputPath);
                next();
            });

            writeStream.on("error", (err) => {
                fail(err);
            });

            stream.pipe(writeStream);
        });

        extractor.on("finish", () => {
            resolve({
                manifest,
                files: extractedFiles,
            });
        });

        /* v8 ignore start */
        extractor.on("error", (err) => {
            readStream.destroy();
            reject(err);
        });
        readStream.on("error", (err) => {
            extractor.destroy(err);
            reject(err);
        });
        /* v8 ignore end */

        readStream.pipe(extractor);
    });
}

/**
 * Where a member of an older TAR lands in its extraction folder.
 *
 * The name of a member comes from the backup file, which whoever can write to its destination
 * chose. Only a regular file with a plain file name is extracted, never a link, a folder or a
 * device, and only straight into the folder: the joined path is checked to stay inside it with
 * the separator, so a sibling folder like `<dir>-evil` never passes for it.
 */
function memberTarget(extractDir: string, header: { name: string; type?: string | null }): string {
    if (header.type !== "file") {
        throw new Error(`Refusing TAR member '${header.name}': it is a ${header.type ?? "unknown"} entry, not a regular file`);
    }
    const name = assertPlainFileName(header.name, "TAR member");
    const root = path.resolve(extractDir);
    const target = path.join(root, path.basename(name));
    if (!target.startsWith(root + path.sep)) {
        throw new Error(`Zip Slip detected: ${header.name}`);
    }
    return target;
}

/**
 * Refuses a manifest whose `filename` of a database is no plain file name.
 *
 * The restores look the dump of each database up by that name, so a name like `../../x` must
 * never reach a path of the server.
 */
export function assertManifestFileNames(manifest: TarManifest): void {
    if (!Array.isArray(manifest.databases)) {
        throw new Error("TAR manifest lists no databases");
    }
    for (const db of manifest.databases) {
        assertPlainFileName(db.filename, `the file of database '${db.name}' in the TAR manifest`);
    }
}

/**
 * The extracted dump of one database of the manifest, found among the files the extraction
 * wrote by its plain file name, never joined from the name the manifest holds.
 */
export function extractedFileOf(files: readonly string[], entry: DatabaseEntry): string {
    const filename = assertPlainFileName(entry.filename, `the file of database '${entry.name}' in the TAR manifest`);
    const file = files.find((f) => path.basename(f) === filename);
    if (!file) {
        throw new Error(`Database file not found in archive: ${filename}`);
    }
    return file;
}

/**
 * Check if a file is a Multi-DB TAR archive
 *
 * Checks for TAR magic bytes and verifies manifest.json exists
 *
 * @param filePath - Path to the file to check
 * @returns True if the file is a Multi-DB TAR archive
 */
export async function isMultiDbTar(filePath: string): Promise<boolean> {
    if (!existsSync(filePath)) {
        return false;
    }

    try {
        const fd = await fs.open(filePath, "r");
        const buffer = Buffer.alloc(512);
        await fd.read(buffer, 0, 512, 0);
        await fd.close();

        // Check for "ustar" magic at offset 257 (POSIX tar format)
        const ustarMagic = buffer.slice(257, 262).toString();
        if (ustarMagic !== "ustar") {
            // Also check first entry filename for manifest.json
            const headerName = buffer.slice(0, 100).toString().replace(/\0/g, "").trim();
            if (headerName !== MANIFEST_FILENAME) {
                return false;
            }
        }

        // Verify manifest exists by trying to read it
        const manifest = await readTarManifest(filePath);
        return manifest !== null;
    /* v8 ignore start */
    } catch (error) {
        // A manifest past what any writer stores is a damaged backup, not some other file.
        if (error instanceof DamagedBackupError) throw error;
        return false;
    }
    /* v8 ignore end */
}

/**
 * The largest `manifest.json` of a multi-database TAR a reader takes. The writer stored a name, a
 * file name and a few fields per database, so even thousands of databases stay far below it.
 */
export const TAR_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Read only the manifest from a TAR archive without extracting files
 *
 * @param filePath - Path to the TAR archive
 * @returns The manifest or null if not found/invalid
 * @throws DamagedBackupError when the manifest is larger than `TAR_MANIFEST_MAX_BYTES`, refused by
 * the size of its header before any of it is read into memory
 */
export async function readTarManifest(filePath: string): Promise<TarManifest | null> {
    return new Promise((resolve, reject) => {
        const extractor = extract();
        let manifestFound = false;
        const readStream = createReadStream(filePath);

        extractor.on("entry", (header, stream, next) => {
            if (header.name === MANIFEST_FILENAME) {
                // The header comes from the backup, so its size decides nothing but this refusal.
                if ((header.size ?? 0) > TAR_MANIFEST_MAX_BYTES) {
                    manifestFound = true;
                    reject(new DamagedBackupError(`its manifest.json is ${header.size} bytes, more than the ${TAR_MANIFEST_MAX_BYTES} any backup writes`));
                    readStream.destroy();
                    extractor.destroy();
                    return;
                }
                const chunks: Buffer[] = [];
                let length = 0;

                stream.on("data", (chunk: Buffer) => {
                    length += chunk.length;
                    if (length > TAR_MANIFEST_MAX_BYTES) {
                        manifestFound = true;
                        reject(new DamagedBackupError(`its manifest.json holds more than the ${TAR_MANIFEST_MAX_BYTES} bytes any backup writes`));
                        readStream.destroy();
                        extractor.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });

                stream.on("end", () => {
                    try {
                        const content = Buffer.concat(chunks).toString("utf-8");
                        const manifest = JSON.parse(content) as TarManifest;
                        manifestFound = true;
                        resolve(manifest);
                        // Destroy stream to stop reading
                        extractor.destroy();
                    } catch {
                        resolve(null);
                    }
                });
            } else {
                // Skip other entries
                stream.resume();
                next();
            }
        });

        extractor.on("finish", () => {
            if (!manifestFound) {
                resolve(null);
            }
        });

        extractor.on("error", () => {
            readStream.destroy();
            resolve(null);
        });

        extractor.on("close", () => {
            readStream.destroy();
        });

        readStream.on("error", () => {
            extractor.destroy();
            resolve(null);
        });
        readStream.pipe(extractor);
    });
}

/**
 * Create a temporary directory for extracting/creating TAR archives
 *
 * @param prefix - Prefix for the directory name
 * @returns Path to the created temporary directory
 */
export async function createTempDir(prefix: string = "multidb-"): Promise<string> {
    const tmpBase = getTempDir();
    await fs.mkdir(tmpBase, { recursive: true });
    // mkdtemp picks a random name and fails rather than reuse a folder someone else made.
    return fs.mkdtemp(path.join(tmpBase, prefix));
}

/**
 * Clean up a temporary directory and all its contents
 *
 * @param dirPath - Path to the directory to remove
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Helper to determine if a database mapping indicates the database should be restored
 *
 * @param dbName - Original database name
 * @param mapping - Database mapping from config
 * @returns True if the database should be restored
 */
export function shouldRestoreDatabase(
    dbName: string,
    mapping?: { originalName: string; targetName: string; selected: boolean }[]
): boolean {
    if (!mapping || mapping.length === 0) {
        return true; // No mapping = restore all
    }

    const entry = mapping.find((m) => m.originalName === dbName);
    return entry ? entry.selected : false;
}

/**
 * Get the target database name from mapping
 *
 * @param dbName - Original database name
 * @param mapping - Database mapping from config
 * @returns Target database name (or original if no mapping)
 */
export function getTargetDatabaseName(
    dbName: string,
    mapping?: { originalName: string; targetName: string; selected: boolean }[]
): string {
    if (!mapping || mapping.length === 0) {
        return dbName;
    }

    const entry = mapping.find((m) => m.originalName === dbName);
    return entry?.targetName || dbName;
}
