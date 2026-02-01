import { isMultiDbTar, readTarManifest } from "../common/tar-utils";

/**
 * Analyze a MongoDB dump file to detect contained databases
 *
 * For TAR archives: reads the manifest
 * For single archives: returns empty (single DB archives don't contain DB list metadata)
 */
export async function analyzeDump(sourcePath: string): Promise<string[]> {
    // Check if this is a Multi-DB TAR archive
    const isTar = await isMultiDbTar(sourcePath);

    if (isTar) {
        const manifest = await readTarManifest(sourcePath);
        if (manifest) {
            return manifest.databases.map(db => db.name);
        }
    }

    // Single MongoDB archives don't contain a DB list in a parseable way
    // Return empty - the caller should use getDatabases() to list available DBs
    return [];
}
