import { isMultiDbTar, readTarManifest } from "../common/tar-utils";

/**
 * .fbk is Firebird's binary backup format - unlike MySQL's SQL text dumps,
 * it cannot be grep-parsed to recover the source database name. For single-file
 * backups the alias name is only known from BackupMetadata.databases (recorded
 * at dump time); returning [] here makes the restore UI fall back to the target
 * source's configured alias dropdown, which is the correct UX for Firebird anyway.
 */
// LEGACY-FORMAT(read): Lists the databases of a backup file written before the seekable
// archive. A seekable archive is listed from its index instead.
export async function analyzeDump(sourcePath: string): Promise<string[]> {
    if (await isMultiDbTar(sourcePath)) {
        const manifest = await readTarManifest(sourcePath);
        return manifest ? manifest.databases.map((d) => d.name) : [];
    }

    return [];
}
