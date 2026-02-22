/**
 * TAR Archive Utilities for Multi-DB Backups
 *
 * Provides functions to create and extract TAR archives containing
 * multiple database dumps with a manifest file.
 */

import { createReadStream, createWriteStream, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { pack, extract } from "tar-stream";
import { pipeline } from "stream/promises";
import { getTempDir } from "@/lib/temp-dir";
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
            fileStream.on("error", reject);
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
                    // Write database dump file
                    const outputPath = path.join(extractDir, header.name);
                    await fs.writeFile(outputPath, content);
                    extractedFiles.push(outputPath);
                }

                next();
            });

            stream.on("error", (err) => {
                reject(err);
            });

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

        extractor.on("error", (err) => {
            reject(err);
        });

        createReadStream(sourcePath).pipe(extractor);
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

            writeStream.on("error", (err) => {
                reject(err);
            });

            stream.pipe(writeStream);
        });

        extractor.on("finish", () => {
            resolve({
                manifest,
                files: extractedFiles,
            });
        });

        extractor.on("error", (err) => {
            reject(err);
        });

        createReadStream(sourcePath).pipe(extractor);
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
    } catch {
        return false;
    }
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
            resolve(null);
        });

        extractor.on("close", () => {
            // Handle early close from destroy()
        });

        createReadStream(filePath).pipe(extractor);
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
