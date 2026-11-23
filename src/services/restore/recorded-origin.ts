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
 *
 * The record names a path, and whoever writes the destination can lay other bytes there. So a run
 * that recorded the SHA-256 of its index counts only while the index the restore reads has those
 * bytes, the check `chain-planner.ts` makes too. Every file of the archive is checked against its
 * line in the index, so the index decides the content. A run of a version that recorded no digest
 * proves nothing about the bytes, and counts for a platform admin with a session alone.
 */

import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";
import { archiveIndexService } from "@/services/backup/archive-index-service";

/** How many runs of the same job and path are looked at, the newest first. A path is rarely written twice. */
const RUNS_LOOKED_AT = 20;

/** The path as the runner records it, without a leading slash or backslashes. */
function cleanPath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Whether the metadata of a run says it wrote this path to this destination with success: false
 * when not, else the digest of its index, null for a run that recorded none.
 */
function wroteTo(metadata: string | null, destinationId: string, file: string): false | { indexSha256: string | null } {
    if (!metadata) return false;
    let parsed: { destinations?: unknown; indexSha256?: unknown };
    try {
        parsed = JSON.parse(metadata);
    } catch {
        return false;
    }
    const destinations = Array.isArray(parsed?.destinations) ? (parsed.destinations as { configId?: unknown; path?: unknown; status?: unknown }[]) : [];
    const wrote = destinations.some((destination) =>
        destination?.configId === destinationId
        && destination.status === "success"
        && typeof destination.path === "string"
        && cleanPath(destination.path) === file);
    if (!wrote) return false;
    return { indexSha256: typeof parsed.indexSha256 === "string" && parsed.indexSha256 ? parsed.indexSha256 : null };
}

/** What the restore knows of the backup it reads, for `archiveReadSource`. */
export interface OriginProof {
    /** The SHA-256 of the index the restore parses, read from the index sidecar when left out. */
    indexSha256?: string | null;
    /** Whether a run that recorded no digest counts: for a platform admin with a session. */
    trustsUnhashed: boolean;
}

/** The SHA-256 of the index sidecar of a backup, null when it has none or it does not read. */
async function sidecarDigest(destinationId: string, file: string): Promise<string | null> {
    try {
        const bytes = await archiveIndexService.fetchSidecar(destinationId, file, INDEX_SIDECAR_SUFFIX);
        return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    } catch {
        return null;
    }
}

/**
 * Whether a recorded backup run of the job that owns the directory source wrote this file to this
 * destination, with the index the restore reads, see the module. The source and its runs are read
 * for every tenant, as their ids name them: the job of the source pins the tenant, and the path is
 * the one the run recorded, so a path in the view of a customer on a shared destination never counts.
 *
 * @param destinationId - The destination the restore reads the backup from
 * @param file - The path of the backup at that destination, as the restore was asked for it
 * @param jobSourceId - The directory source the restore would write back into
 * @param proof - The digest of the index the restore reads, and whether a run without one counts
 */
export async function archiveReadSource(destinationId: string, file: string, jobSourceId: string, proof: OriginProof): Promise<boolean> {
    const clean = cleanPath(file);
    if (!clean || !destinationId || !jobSourceId) return false;
    const recorded = await runAsSystem(async () => {
        const source = await prisma.jobSource.findUnique({ where: { id: jobSourceId }, select: { jobId: true } });
        if (!source?.jobId) return [];
        const runs = await prisma.execution.findMany({
            // The runner records the path without a leading slash, older runs may have one.
            where: { type: "Backup", jobId: source.jobId, path: { in: [clean, `/${clean}`] } },
            orderBy: { startedAt: "desc" },
            take: RUNS_LOOKED_AT,
            select: { metadata: true },
        });
        return runs.flatMap((run) => {
            const wrote = wroteTo(run.metadata, destinationId, clean);
            return wrote ? [wrote] : [];
        });
    });
    if (recorded.length === 0) return false;
    if (recorded.some((run) => run.indexSha256 === null) && proof.trustsUnhashed) return true;
    const digests = recorded.flatMap((run) => (run.indexSha256 ? [run.indexSha256] : []));
    if (digests.length === 0) return false;
    // In the view of the caller, like the restore reads it.
    const read = proof.indexSha256 !== undefined ? proof.indexSha256 : await sidecarDigest(destinationId, clean);
    return !!read && digests.includes(read);
}
