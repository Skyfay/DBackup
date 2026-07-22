/**
 * TAR Archive Utilities for Multi-DB Backups
 *
 * Provides functions to create and extract TAR archives containing
 * multiple database dumps with a manifest file.
 */

import { createReadStream, createWriteStream, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { pack, extract, Pack } from "tar-stream";
import { pipeline } from "stream/promises";
import { getTempDir } from "@/lib/temp-dir";
import { getCompressionStream, getDecompressionStream } from "@/lib/crypto/compression";
import {
    TarManifest,
    TarFileEntry,
    ExtractResult,
    CreateTarOptions,
    DatabaseEntry,
    TarManifestV2,
    DbEntryV2,
    DirectoryEntryV2,
    ManifestEntryV2,
    CombinedTarFileEntry,
    CombinedExtractSelection,
    CombinedExtractResult,
} from "./types";

/** Manifest filename inside the TAR archive */
export const MANIFEST_FILENAME = "manifest.json";

/** Metadata member name (relative to a directory entry's pathPrefix) holding its per-file index. Not real backup data - skipped on extraction. */
export const DIRECTORY_INDEX_FILENAME = ".dbackup-index.json";

/** Tar member filename extension per dump format, used for "databases/<name>.<ext>" entries in combined (v2) archives. */
const EXTENSION_BY_FORMAT: Record<DbEntryV2["format"], string> = {
    sql: "sql",
    custom: "dump",
    archive: "archive",
    fbk: "fbk",
};

/**
 * Compresses a local file to a new temporary file (GZIP/BROTLI) and returns its path. Used by
 * createCombinedTar() to compress individual entries before they're streamed into the tar -
 * caller owns cleanup of the returned temp file.
 */
async function compressFileToTemp(localPath: string, compression: "GZIP" | "BROTLI"): Promise<string> {
    const ext = compression === "GZIP" ? ".gz" : ".br";
    const compressedPath = path.join(getTempDir(), `combined-compress-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    const compressStream = getCompressionStream(compression);
    if (!compressStream) {
        throw new Error(`Unsupported compression type: ${compression}`);
    }
    await pipeline(createReadStream(localPath), compressStream, createWriteStream(compressedPath));
    return compressedPath;
}

/** Streams a local file into a new tar entry under the given member name. */
async function addFileToTar(tarPack: Pack, tarName: string, localPath: string): Promise<void> {
    const stats = await fs.stat(localPath);
    const entry = tarPack.entry({ name: tarName, size: stats.size });
    const fileStream = createReadStream(localPath);
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

/**
 * Create a TAR archive containing multiple database dumps
 *
 * @param files - Array of files to include in the archive
 * @param destinationPath - Path where the TAR archive will be created
 * @param options - Options including sourceType and engineVersion
 * @returns The created manifest
 */
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
 * Extract a Multi-DB TAR archive
 *
 * @param sourcePath - Path to the TAR archive
 * @param extractDir - Directory to extract files into
 * @returns The manifest and list of extracted file paths
 */
export async function extractMultiDbTar(
    sourcePath: string,
    extractDir: string
): Promise<ExtractResult> {
    // Ensure extract directory exists
    await fs.mkdir(extractDir, { recursive: true });

    let manifest: TarManifest | null = null;
    const extractedFiles: string[] = [];

    return new Promise((resolve, reject) => {
        const extractor = extract();

        extractor.on("entry", (header, stream, next) => {
            const entryChunks: Buffer[] = [];

            stream.on("data", (chunk: Buffer) => {
                entryChunks.push(chunk);
            });

            stream.on("end", async () => {
                const content = Buffer.concat(entryChunks);

                if (header.name === MANIFEST_FILENAME) {
                    // Parse manifest
                    try {
                        manifest = JSON.parse(content.toString("utf-8"));
                    } catch (err) {
                        reject(new Error(`Failed to parse manifest: ${err}`));
                        return;
                    }
                } else {
                    // Write database dump file (validate path to prevent Zip Slip)
                    const outputPath = path.join(extractDir, path.basename(header.name));
                    /* v8 ignore start */
                    if (!outputPath.startsWith(extractDir)) {
                        reject(new Error(`Zip Slip detected: ${header.name}`));
                        return;
                    }
                    /* v8 ignore end */
                    await fs.writeFile(outputPath, content);
                    extractedFiles.push(outputPath);
                }

                next();
            });

            /* v8 ignore start */
            stream.on("error", (err) => {
                reject(err);
            });
            /* v8 ignore end */

            stream.resume();
        });

        extractor.on("finish", () => {
            if (!manifest) {
                reject(new Error("TAR archive does not contain a manifest.json"));
                return;
            }

            resolve({
                manifest,
                files: extractedFiles,
            });
        });
        const readStream = createReadStream(sourcePath);
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

        extractor.on("entry", (header, stream, next) => {
            // Skip manifest (already parsed) and non-selected files
            if (header.name === MANIFEST_FILENAME || !selectedFilenames.has(header.name)) {
                stream.resume();
                next();
                return;
            }

            // Write selected database dump file
            const outputPath = path.join(extractDir, header.name);
            const writeStream = createWriteStream(outputPath);

            writeStream.on("finish", () => {
                extractedFiles.push(outputPath);
                next();
            });

            /* v8 ignore start */
            writeStream.on("error", (err) => {
                reject(err);
            });
            /* v8 ignore end */

            stream.pipe(writeStream);
        });

        extractor.on("finish", () => {
            resolve({
                manifest,
                files: extractedFiles,
            });
        });

        const readStream = createReadStream(sourcePath);
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
    } catch {
        return false;
    }
    /* v8 ignore end */
}

/**
 * Read only the manifest from a TAR archive without extracting files
 *
 * @param filePath - Path to the TAR archive
 * @returns The manifest or null if not found/invalid
 */
export async function readTarManifest(filePath: string): Promise<TarManifest | null> {
    return new Promise((resolve) => {
        const extractor = extract();
        let manifestFound = false;
        const readStream = createReadStream(filePath);

        extractor.on("entry", (header, stream, next) => {
            if (header.name === MANIFEST_FILENAME) {
                const chunks: Buffer[] = [];

                stream.on("data", (chunk: Buffer) => {
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
    const dirName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dirPath = path.join(tmpBase, dirName);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
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

// ── Manifest v2 (combined DB + directory-source archives) ──────────────────
//
// Additive to everything above - createMultiDbTar/readTarManifest/extractSelectedDatabases
// are never modified and remain the correct tools for pure-database (v1) archives, which is
// what every DB-only job produces forever. The functions below are only ever exercised by the
// combined dump/restore path (JobSource feature), which only runs for jobs that actually have
// directory sources.

/**
 * Create a combined TAR archive containing database dumps and/or directory-source file
 * trees. Generalization of createMultiDbTar() - database entries land under
 * "databases/<name>.<ext>" exactly as in a v1 archive; each directory entry's files land
 * under "sources/<jobSourceId>/<relativePath>", namespaced by a UUID so they can never
 * collide with a database entry's filename or another directory entry's files. A per-file
 * index is written alongside each directory entry's files (see DIRECTORY_INDEX_FILENAME) for
 * future searchable-file-browsing use - it is metadata, not backup data.
 *
 * @param entries - Database dump files and/or directory roots to include
 * @param destinationPath - Path where the TAR archive will be created
 * @param options - sourceType/engineVersion for the manifest
 * @returns The created v2 manifest
 */
export async function createCombinedTar(
    entries: CombinedTarFileEntry[],
    destinationPath: string,
    options: CreateTarOptions
): Promise<TarManifestV2> {
    const tarPack = pack();
    const outputStream = createWriteStream(destinationPath);
    const pipelinePromise = pipeline(tarPack, outputStream);

    const externalCompression = options.compression && options.compression !== "NONE" ? options.compression : undefined;

    const manifestEntries: ManifestEntryV2[] = [];
    // Local path actually streamed into the tar for each database entry (may be a temp
    // compressed file instead of the original dump when per-entry compression applies) -
    // resolved once here so the write loop below never re-decides or re-compresses.
    const resolvedDbPaths: string[] = [];
    const tempFilesToClean: string[] = [];
    let totalSize = 0;

    try {
        for (const entry of entries) {
            if (entry.kind === "database") {
                const shouldCompress = !!externalCompression && !entry.nativeCompression;
                const sourcePath = shouldCompress ? await compressFileToTemp(entry.path, externalCompression!) : entry.path;
                if (shouldCompress) tempFilesToClean.push(sourcePath);
                resolvedDbPaths.push(sourcePath);

                const stats = await fs.stat(sourcePath);
                manifestEntries.push({
                    kind: "database",
                    name: entry.dbName,
                    filename: `databases/${entry.dbName}.${EXTENSION_BY_FORMAT[entry.format]}`,
                    size: stats.size,
                    format: entry.format,
                    ...(shouldCompress ? { compressed: externalCompression } : {}),
                });
                totalSize += stats.size;
            } else {
                const dirTotalSize = entry.files.reduce((sum, f) => sum + f.size, 0);
                manifestEntries.push({
                    kind: "directory",
                    jobSourceId: entry.jobSourceId,
                    label: entry.label,
                    pathPrefix: `sources/${entry.jobSourceId}`,
                    fileCount: entry.files.length,
                    totalSize: dirTotalSize,
                    excludePatterns: entry.excludePatterns,
                    ...(externalCompression ? { compressed: externalCompression } : {}),
                });
                totalSize += dirTotalSize;
            }
        }

        const manifest: TarManifestV2 = {
            version: 2,
            createdAt: new Date().toISOString(),
            sourceType: options.sourceType,
            engineVersion: options.engineVersion,
            entries: manifestEntries,
            totalSize,
            perEntryCompression: true,
        };

        // Add manifest.json as first entry
        const manifestJson = JSON.stringify(manifest, null, 2);
        const manifestBuffer = Buffer.from(manifestJson, "utf-8");

        const manifestEntryHandle = tarPack.entry({ name: MANIFEST_FILENAME, size: manifestBuffer.length });
        manifestEntryHandle.end(manifestBuffer);

        let dbIndex = 0;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (entry.kind === "database") {
                const manifestEntry = manifestEntries[i] as DbEntryV2;
                await addFileToTar(tarPack, manifestEntry.filename, resolvedDbPaths[dbIndex]);
                dbIndex++;
            } else {
                const manifestEntry = manifestEntries[i] as DirectoryEntryV2;

                const indexBuffer = Buffer.from(JSON.stringify(entry.files), "utf-8");
                const indexEntryHandle = tarPack.entry({
                    name: `${manifestEntry.pathPrefix}/${DIRECTORY_INDEX_FILENAME}`,
                    size: indexBuffer.length,
                });
                indexEntryHandle.end(indexBuffer);

                for (const file of entry.files) {
                    const localFilePath = path.join(entry.localPath, file.path);
                    if (manifestEntry.compressed) {
                        const compressedPath = await compressFileToTemp(localFilePath, manifestEntry.compressed);
                        tempFilesToClean.push(compressedPath);
                        await addFileToTar(tarPack, `${manifestEntry.pathPrefix}/${file.path}`, compressedPath);
                    } else {
                        await addFileToTar(tarPack, `${manifestEntry.pathPrefix}/${file.path}`, localFilePath);
                    }
                }
            }
        }

        tarPack.finalize();
        await pipelinePromise;

        return manifest;
    } finally {
        for (const f of tempFilesToClean) {
            await fs.unlink(f).catch(() => {});
        }
    }
}

/**
 * Read only the archive format version from a TAR's manifest.json, without fully typing the
 * result. Reuses readTarManifest()'s existing stream-until-manifest-found logic (correct for
 * both v1 and v2 shapes, since it's a plain JSON.parse), rather than duplicating it.
 *
 * @param filePath - Path to the TAR archive
 * @returns The manifest's `version` field, or null if no valid manifest.json is present
 */
export async function readManifestVersion(filePath: string): Promise<number | null> {
    const manifest = await readTarManifest(filePath);
    if (!manifest) return null;
    return (manifest as unknown as { version: number }).version;
}

/**
 * Read only the v2 manifest from a combined TAR archive, without extracting files.
 * v2-typed equivalent of readTarManifest() - returns null (rather than a wrongly-typed v1
 * object) when the archive's manifest is not version 2.
 *
 * @param filePath - Path to the TAR archive
 * @returns The v2 manifest, or null if not found/invalid/not version 2
 */
export async function readCombinedManifest(filePath: string): Promise<TarManifestV2 | null> {
    const manifest = await readTarManifest(filePath);
    if (!manifest) return null;
    if ((manifest as unknown as { version: number }).version !== 2) return null;
    return manifest as unknown as TarManifestV2;
}

/**
 * Extract selected database and/or directory entries from a combined (v2) TAR archive.
 * Generalization of extractSelectedDatabases() - database entries are matched by exact
 * filename (as in a v1 archive); directory entries are matched by path-prefix, since one
 * directory entry spans many tar members. The per-file index member
 * (sources/<jobSourceId>/.dbackup-index.json) is metadata, not backup data - it is never
 * written to extractDir. Unselected/unknown entries (including manifest.json itself) are
 * skipped via stream.resume() without I/O.
 *
 * @param sourcePath - Path to the combined TAR archive
 * @param extractDir - Directory to extract files into
 * @param selection - Which database/directory entries to extract. Omitting this argument
 * entirely extracts everything; once provided, each field is explicit on its own - a field
 * left undefined (or an empty array) means "none of this kind", not "all". See
 * CombinedExtractSelection for the full explanation.
 * @returns The manifest, extracted database dump file paths, and extracted directory roots
 */
export async function extractCombinedArchive(
    sourcePath: string,
    extractDir: string,
    selection?: CombinedExtractSelection
): Promise<CombinedExtractResult> {
    await fs.mkdir(extractDir, { recursive: true });

    const manifest = await readCombinedManifest(sourcePath);
    if (!manifest) {
        throw new Error("TAR archive does not contain a valid v2 manifest.json");
    }

    const isDbWanted = (name: string): boolean =>
        !selection ? true : (selection.databaseNames?.includes(name) ?? false);
    const isDirWanted = (jobSourceId: string): boolean =>
        !selection ? true : (selection.directoryJobSourceIds?.includes(jobSourceId) ?? false);

    const wantedDbFilenames = new Map<string, DbEntryV2>();
    for (const entry of manifest.entries) {
        if (entry.kind !== "database") continue;
        if (isDbWanted(entry.name)) {
            wantedDbFilenames.set(entry.filename, entry);
        }
    }

    // Keyed by prefix WITH trailing slash, so a directory entry's prefix can never
    // accidentally match another entry whose prefix is merely a string-prefix of it
    // (e.g. "sources/abc" must not match members under "sources/abcdef/").
    const wantedDirPrefixes = new Map<string, DirectoryEntryV2>();
    for (const entry of manifest.entries) {
        if (entry.kind !== "directory") continue;
        if (isDirWanted(entry.jobSourceId)) {
            wantedDirPrefixes.set(`${entry.pathPrefix}/`, entry);
        }
    }

    const databaseFiles: CombinedExtractResult["databaseFiles"] = [];
    const directoryRoots: CombinedExtractResult["directoryRoots"] = [];
    const seenDirectoryRoots = new Set<string>();

    await new Promise<void>((resolve, reject) => {
        const extractor = extract();

        extractor.on("entry", (header, stream, next) => {
            const dbEntry = wantedDbFilenames.get(header.name);
            if (dbEntry) {
                const outputPath = path.join(extractDir, header.name);
                fs.mkdir(path.dirname(outputPath), { recursive: true })
                    .then(() => {
                        const writeStream = createWriteStream(outputPath);
                        writeStream.on("finish", () => {
                            databaseFiles.push({ entry: dbEntry, path: outputPath });
                            next();
                        });
                        /* v8 ignore start */
                        writeStream.on("error", (err) => reject(err));
                        /* v8 ignore end */
                        // `compressed` is only ever set on archives written with per-entry compression -
                        // absent on older archives, which are written straight through unchanged.
                        const decompressStream = dbEntry.compressed ? getDecompressionStream(dbEntry.compressed) : null;
                        if (decompressStream) {
                            /* v8 ignore start */
                            decompressStream.on("error", (err) => reject(err));
                            /* v8 ignore end */
                            stream.pipe(decompressStream).pipe(writeStream);
                        } else {
                            stream.pipe(writeStream);
                        }
                    })
                    /* v8 ignore next */
                    .catch(reject);
                return;
            }

            const matchedPrefix = [...wantedDirPrefixes.keys()].find((prefix) => header.name.startsWith(prefix));
            if (matchedPrefix) {
                const dirEntry = wantedDirPrefixes.get(matchedPrefix)!;
                const rootPath = path.join(extractDir, "sources", dirEntry.jobSourceId);

                if (!seenDirectoryRoots.has(dirEntry.jobSourceId)) {
                    seenDirectoryRoots.add(dirEntry.jobSourceId);
                    directoryRoots.push({ entry: dirEntry, path: rootPath });
                }

                const suffix = header.name.slice(matchedPrefix.length);

                // The per-file index is metadata, not backup data - skip it without I/O.
                if (suffix === DIRECTORY_INDEX_FILENAME) {
                    stream.resume();
                    next();
                    return;
                }

                // Flat per-file layout: each file is its own tar member, individually decompressed
                // when `compressed` is set (kept per-file, not bundled, so a single file can be
                // read/restored without touching the rest of the source - important for future
                // file-level restore/browsing). `compressed` is absent on archives written before
                // per-entry compression support, which are written straight through unchanged.
                const outputPath = path.join(rootPath, suffix);
                if (!outputPath.startsWith(rootPath)) {
                    reject(new Error(`Zip Slip detected: ${header.name}`));
                    return;
                }

                fs.mkdir(path.dirname(outputPath), { recursive: true })
                    .then(() => {
                        const writeStream = createWriteStream(outputPath);
                        writeStream.on("finish", () => next());
                        /* v8 ignore start */
                        writeStream.on("error", (err) => reject(err));
                        /* v8 ignore end */
                        const decompressStream = dirEntry.compressed ? getDecompressionStream(dirEntry.compressed) : null;
                        if (decompressStream) {
                            /* v8 ignore start */
                            decompressStream.on("error", (err) => reject(err));
                            /* v8 ignore end */
                            stream.pipe(decompressStream).pipe(writeStream);
                        } else {
                            stream.pipe(writeStream);
                        }
                    })
                    /* v8 ignore next */
                    .catch(reject);
                return;
            }

            // manifest.json and any unselected/unknown entry
            stream.resume();
            next();
        });

        extractor.on("finish", () => resolve());

        const readStream = createReadStream(sourcePath);
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

    return { manifest, databaseFiles, directoryRoots };
}
