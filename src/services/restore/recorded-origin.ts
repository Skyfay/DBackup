/**
 * Whether a backup holds the files of a directory source, by the run that wrote it, never by the
 * files at the destination or the ids of a request.
 *
 * A restore writes back into the folder a directory source read without the right to change that
 * connection, see `writeTargetRefusal`. Which source the files of an archive came from is said by
 * its index, which lies at the destination, and by the selection or mapping of the request. Whoever
 * lays an archive there could name the source of any job in it, also one on the server DBackup runs
 * on, and restore files of their own into its folder. So a restore counts as one to the origin only
 * when a backup run of the job that owns the source recorded this file at this destination, in
 * `Execution.metadata` like `recorded-encryption.ts` reads it.
 *
 * A backup with no such record, imported from elsewhere, laid at the destination or whose run was
 * cleaned up from History, is restored as into any other place, which needs the right to change
 * the connection.
 */

import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";

/** How many runs of the same job and path are looked at, the newest first. A path is rarely written twice. */
const RUNS_LOOKED_AT = 20;

/** The path as the runner records it, without a leading slash or backslashes. */
function cleanPath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Whether the metadata of a run says it wrote this path to this destination with success. */
function wroteTo(metadata: string | null, destinationId: string, file: string): boolean {
    if (!metadata) return false;
    let parsed: { destinations?: unknown };
    try {
        parsed = JSON.parse(metadata);
    } catch {
        return false;
    }
    const destinations = Array.isArray(parsed?.destinations) ? (parsed.destinations as { configId?: unknown; path?: unknown; status?: unknown }[]) : [];
    return destinations.some((destination) =>
        destination?.configId === destinationId
        && destination.status === "success"
        && typeof destination.path === "string"
        && cleanPath(destination.path) === file);
}

/**
 * Whether a recorded backup run of the job that owns the directory source wrote this file to this
 * destination. The source and its runs are read for every tenant, as their ids name them: the job
 * of the source pins the tenant, and the path is the one the run recorded, so a path in the view
 * of a customer on a shared destination never counts.
 *
 * @param destinationId - The destination the restore reads the backup from
 * @param file - The path of the backup at that destination, as the restore was asked for it
 * @param jobSourceId - The directory source the restore would write back into
 */
export async function archiveReadSource(destinationId: string, file: string, jobSourceId: string): Promise<boolean> {
    const clean = cleanPath(file);
    if (!clean || !destinationId || !jobSourceId) return false;
    return runAsSystem(async () => {
        const source = await prisma.jobSource.findUnique({ where: { id: jobSourceId }, select: { jobId: true } });
        if (!source?.jobId) return false;
        const runs = await prisma.execution.findMany({
            // The runner records the path without a leading slash, older runs may have one.
            where: { type: "Backup", jobId: source.jobId, path: { in: [clean, `/${clean}`] } },
            orderBy: { startedAt: "desc" },
            take: RUNS_LOOKED_AT,
            select: { metadata: true },
        });
        return runs.some((run) => wroteTo(run.metadata, destinationId, clean));
    });
}
