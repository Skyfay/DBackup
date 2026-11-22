/**
 * What the backup runs of a shared server's tenant recorded about the paths they wrote, never what
 * the sidecar at the destination says.
 *
 * The backups of a shared server are found by the server their `.meta.json` names, and a customer
 * restores one with the login of the provider. Whoever writes the storage outside DBackup could lay
 * an archive with such a sidecar there, so a backup counts for a customer only with a proof that
 * DBackup made it, see `proofOf` in `shared-backups.ts`. The record of a run is one: in
 * `Execution.metadata` it names every destination and path it uploaded to, the SHA-256 of its index
 * and when its dumps started, like `recorded-encryption.ts` and `recorded-origin.ts` read it.
 */

import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

/** How many paths one query asks for, below the 999 variables SQLite takes. */
const PATHS_PER_QUERY = 400;

/** The path as the runner records it, without a leading slash or backslashes. */
export function cleanPath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** What one run recorded about a path it wrote. */
export interface RecordedRun {
    /** The destinations the run uploaded this path to with success. */
    destinations: Set<string>;
    /** The SHA-256 of the index of the archive, null for a run of a version that recorded none. */
    indexSha256: string | null;
    /** When the dumps of the run started, or the run itself where it recorded no dump start. ISO 8601. */
    startedAt: string;
    /** When the run ended, null while it runs. ISO 8601. */
    endedAt: string | null;
}

interface RunRow {
    path: string | null;
    startedAt: Date;
    endedAt: Date | null;
    metadata: string | null;
}

function recordOf(row: RunRow): RecordedRun | null {
    if (!row.metadata) return null;
    let parsed: { destinations?: unknown; indexSha256?: unknown; dumpsStartedAt?: unknown };
    try {
        parsed = JSON.parse(row.metadata);
    } catch {
        return null;
    }
    const destinations = Array.isArray(parsed?.destinations) ? (parsed.destinations as { configId?: unknown; path?: unknown; status?: unknown }[]) : [];
    const path = row.path ? cleanPath(row.path) : "";
    const wrote = new Set(destinations.flatMap((destination) =>
        typeof destination?.configId === "string" && destination.status === "success" && typeof destination.path === "string" && path && cleanPath(destination.path) === path
            ? [destination.configId]
            : []));
    if (wrote.size === 0) return null;
    const dumpsStartedAt = typeof parsed.dumpsStartedAt === "string" && !Number.isNaN(Date.parse(parsed.dumpsStartedAt)) ? parsed.dumpsStartedAt : null;
    return {
        destinations: wrote,
        indexSha256: typeof parsed.indexSha256 === "string" && parsed.indexSha256 ? parsed.indexSha256 : null,
        startedAt: dumpsStartedAt ?? row.startedAt.toISOString(),
        endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    };
}

/**
 * The runs of the tenant that wrote each of these paths with success, newest first, by the path as
 * `cleanPath` gives it. Read for the tenant of the server whatever tenant asks, since a customer
 * reads the backups of its provider.
 *
 * @param tenantId - The tenant of the server, whose runs wrote its backups
 * @param paths - The paths of the backups found at its destinations
 */
export async function recordedRunsOf(tenantId: string, paths: readonly string[]): Promise<Map<string, RecordedRun[]>> {
    const wanted = [...new Set(paths.map(cleanPath).filter(Boolean))];
    const found = new Map<string, RecordedRun[]>();
    if (wanted.length === 0) return found;
    await runAsSystem(async () => {
        for (let start = 0; start < wanted.length; start += PATHS_PER_QUERY) {
            const batch = wanted.slice(start, start + PATHS_PER_QUERY);
            const rows = await prisma.execution.findMany({
                // The runner records the path without a leading slash, older runs may have one.
                where: { tenantId, type: "Backup", path: { in: [...batch, ...batch.map((path) => `/${path}`)] } },
                orderBy: { startedAt: "desc" },
                select: { path: true, startedAt: true, endedAt: true, metadata: true },
            });
            for (const row of rows) {
                const record = recordOf(row);
                if (!record || !row.path) continue;
                const key = cleanPath(row.path);
                const list = found.get(key);
                if (list) list.push(record);
                else found.set(key, [record]);
            }
        }
    });
    return found;
}
