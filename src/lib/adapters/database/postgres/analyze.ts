import { execFileAsync } from "./connection";
import { isMultiDbTar, readTarManifest } from "../common/tar-utils";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "postgres", module: "analyze" });

export async function analyzeDump(sourcePath: string): Promise<string[]> {
    // First check if this is a Multi-DB TAR archive
    const isTar = await isMultiDbTar(sourcePath);

    if (isTar) {
        // Read manifest from TAR archive
        const manifest = await readTarManifest(sourcePath);
        if (manifest) {
            return manifest.databases.map(db => db.name);
        }
    }

    // Fallback: grep for CREATE DATABASE / \connect in plain SQL files
    const dbs = new Set<string>();
    try {
        const { stdout } = await execFileAsync('grep', ['-E', '^CREATE DATABASE |^\\\\connect ', sourcePath], {
            maxBuffer: 10 * 1024 * 1024
        });

        const lines = stdout.split('\n');
        for (const line of lines) {
            const createMatch = line.match(/^CREATE DATABASE "?([^";\s]+)"? /i);
            if (createMatch) dbs.add(createMatch[1]);

            const connectMatch = line.match(/^\\connect "?([^"\s]+)"?/i);
            if (connectMatch) dbs.add(connectMatch[1]);
        }
    } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT' && (err as any).code !== 1) {
            log.error("Error analyzing Postgres dump", { sourcePath }, wrapError(e));
        }
    }
    return Array.from(dbs);
}
