/**
 * Which backups of a shared server a run of its tenant wrote, by the record of the run, never by
 * the sidecar at the destination.
 *
 * The backups of a shared server are found by the server their `.meta.json` names, and a customer
 * restores one with the login of the provider. Whoever writes the storage outside DBackup could lay
 * an archive with such a sidecar there, and it would be listed and restored like one DBackup made.
 * So a backup counts for the server only while a backup run of the server's tenant recorded that
 * it wrote this path to this destination, in `Execution.metadata` like `recorded-encryption.ts`
 * reads it. A backup imported from elsewhere, or whose run was cleaned up from History, is shared
 * with nobody.
 */

import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

/** How many paths one query asks for, below the 999 variables SQLite takes. */
const PATHS_PER_QUERY = 400;

/** The path as the runner records it, without a leading slash or backslashes. */
function cleanPath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** The key of one copy of a backup, a destination and the path there. */
export function copyKey(destinationId: string, path: string): string {
    return `${destinationId}\n${cleanPath(path)}`;
}

/** The copies a run says it uploaded with success, as keys. */
function writtenBy(metadata: string | null): string[] {
    if (!metadata) return [];
    let parsed: { destinations?: unknown };
    try {
        parsed = JSON.parse(metadata);
    } catch {
        return [];
    }
    const destinations = Array.isArray(parsed?.destinations) ? (parsed.destinations as { configId?: unknown; path?: unknown; status?: unknown }[]) : [];
    return destinations.flatMap((destination) =>
        typeof destination?.configId === "string" && destination.status === "success" && typeof destination.path === "string" && cleanPath(destination.path)
            ? [copyKey(destination.configId, destination.path)]
            : []);
}

/**
 * The copies of these a backup run of the tenant recorded, as keys of `copyKey`. Read for the
 * tenant of the server whatever tenant asks, since a customer reads the backups of its provider.
 *
 * @param tenantId - The tenant of the server, whose runs wrote its backups
 * @param copies - The destination and path of each backup found at a destination
 */
export async function recordedCopies(tenantId: string, copies: readonly { destinationId: string; path: string }[]): Promise<Set<string>> {
    const wanted = new Set(copies.map((copy) => copyKey(copy.destinationId, copy.path)));
    const paths = [...new Set(copies.map((copy) => cleanPath(copy.path)).filter(Boolean))];
    const found = new Set<string>();
    if (paths.length === 0) return found;
    await runAsSystem(async () => {
        for (let start = 0; start < paths.length; start += PATHS_PER_QUERY) {
            const batch = paths.slice(start, start + PATHS_PER_QUERY);
            const runs = await prisma.execution.findMany({
                // The runner records the path without a leading slash, older runs may have one.
                where: { tenantId, type: "Backup", path: { in: [...batch, ...batch.map((path) => `/${path}`)] } },
                select: { metadata: true },
            });
            for (const run of runs) {
                for (const key of writtenBy(run.metadata)) if (wanted.has(key)) found.add(key);
            }
        }
    });
    return found;
}
