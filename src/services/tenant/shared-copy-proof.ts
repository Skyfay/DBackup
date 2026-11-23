/**
 * The proof that DBackup made a copy of a backup of a shared server, which a customer reads and
 * restores with the login of the provider. A sidecar at the destination proves nothing, since
 * whoever writes the storage outside DBackup can lay one beside an archive of their own. Two things
 * do, and the `.meta.json` decides only which one is asked:
 *
 * - **recorded**: a backup run of the server's tenant recorded that it wrote this path, see
 *   `recorded-backups.ts`. On another destination than the recorded one, like after a move to a new
 *   storage, the index of the copy has to be the one the run recorded by its SHA-256. On the
 *   recorded destination too where the run recorded it, so nobody swaps the bytes of a plain backup.
 *   The time of the backup is the time of the run, so a changed `.meta.json` moves no backup into
 *   the time of another customer.
 * - **sealed**: the index is encrypted with a key of the server's tenant, which no customer and
 *   nobody without that key can make, wherever the copy lies and whether History still knows it.
 *   The time of the backup is the one sealed in the index.
 *
 * The listing keeps the copies that can carry a proof (`proofOf`). The proof itself is checked
 * where the archive is opened anyway for the download or the restore (`copyProofProblem`), which
 * reads the index alone, never the whole archive.
 */

import { cleanPath, type RecordedRun } from "./recorded-backups";

export type CopyProof =
    | { kind: "recorded"; digests: string[] }
    | { kind: "sealed" };

/** What the listing of a copy gives the proof, from its `.meta.json`. */
interface ListedCopy {
    path: string;
    createdAt: string;
    dumpsStartedAt?: string;
    isEncrypted?: boolean;
}

/** The proof a copy can carry, with the times of the backup the time window judges, null for none. */
export interface ProvenCopy {
    proof: CopyProof;
    createdAt: string;
    dumpsStartedAt?: string;
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/**
 * The times of a recorded backup: its dumps started when the run says, and it was stamped when its
 * `.meta.json` says only while that lies within the run, else when the run ended.
 */
function timesOfRun(run: RecordedRun, listed: ListedCopy): { createdAt: string; dumpsStartedAt: string } {
    const from = time(run.startedAt);
    const until = Number.isNaN(time(run.endedAt)) ? Infinity : time(run.endedAt);
    const stamped = time(listed.createdAt);
    const createdAt = !Number.isNaN(stamped) && stamped >= from && stamped <= until ? listed.createdAt : run.endedAt ?? run.startedAt;
    return { createdAt, dumpsStartedAt: run.startedAt };
}

/**
 * The proof a listed copy can carry, see the module, null when it has none and nobody but the
 * provider sees it. A run that wrote this path to this destination comes first, then one that wrote
 * it elsewhere and recorded the digest of its index, then the claim of the sidecar that the backup
 * is encrypted, which the read checks.
 */
export function proofOf(destinationId: string, listed: ListedCopy, runs: ReadonlyMap<string, RecordedRun[]>): ProvenCopy | null {
    const atPath = runs.get(cleanPath(listed.path)) ?? [];
    const here = atPath.filter((run) => run.destinations.has(destinationId));
    const proving = here.length > 0 ? here : atPath.filter((run) => run.indexSha256 !== null);
    if (proving.length > 0) {
        const digests = [...new Set(proving.flatMap((run) => (run.indexSha256 ? [run.indexSha256] : [])))];
        return { proof: { kind: "recorded", digests }, ...timesOfRun(proving[0], listed) };
    }
    if (listed.isEncrypted) {
        return { proof: { kind: "sealed" }, createdAt: listed.createdAt, ...(listed.dumpsStartedAt ? { dumpsStartedAt: listed.dumpsStartedAt } : {}) };
    }
    return null;
}

/** What `copyProofProblem` reads of an archive opened in the tenant of the server. */
export interface OpenedCopy {
    manifest: { encryption?: unknown };
    masterKey?: Buffer;
    indexSha256: string;
    index: { header: { createdAt: string } };
}

/**
 * Why an opened copy is not the backup its proof stands for, for the log, null when it is.
 *
 * @param heldAt - Whether the customer held the database at a time, for the time sealed in the index
 */
export function copyProofProblem(proof: CopyProof, archive: OpenedCopy, heldAt: (iso: string) => boolean): string | null {
    if (proof.kind === "recorded") {
        // A run of a version that recorded no digest proves the path on its own destination alone.
        if (proof.digests.length === 0 || proof.digests.includes(archive.indexSha256)) return null;
        return "the index is not the one its run recorded";
    }
    // Opened in the tenant of the server, so the key is one of its own, see `readableCopy`.
    if (!archive.manifest.encryption || !archive.masterKey) return "the backup is not encrypted with a key of the server's tenant";
    const sealedAt = archive.index.header.createdAt;
    if (Number.isNaN(time(sealedAt))) return "the index names no time";
    if (!heldAt(sealedAt)) return "the time sealed in the index is not one of the customer's";
    return null;
}
