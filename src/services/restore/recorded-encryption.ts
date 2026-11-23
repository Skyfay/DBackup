/**
 * Whether a backup has to be encrypted, by the run that wrote it, never by the files beside it.
 *
 * The `.meta.json` and the manifest of an archive come from the destination, so whoever writes
 * there can lay a plain backup with a plain sidecar where an encrypted one was, and a restore that
 * trusts them would write that backup into a server as if DBackup had made it. The run of a job
 * keeps in `Execution.metadata` whether its archive was encrypted and with which key (see
 * `combined-dump.ts` and `04-completion.ts`), along with the path of every destination it reached.
 * That record is the one the destination cannot change, so a restore, a download and a read of
 * the index ask it here before they trust a backup without encryption.
 *
 * A backup with no record, imported from elsewhere, older than the record or whose run was
 * cleaned up, is read as before. Its job is asked whether it encrypts now, which only warns.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runAsTenant } from "@/lib/tenant/context";

const log = logger.child({ service: "RecordedEncryption" });

/** How many runs of the same path are looked at, the newest first. A path is rarely written twice. */
const RUNS_LOOKED_AT = 20;

/** What the run that wrote a backup recorded about its encryption. */
export interface RecordedEncryption {
    encrypted: boolean;
    /** The key of the run, when it encrypted. Never shown to a customer. */
    profileId: string | null;
    executionId: string;
}

/**
 * Refuses a backup that its run wrote encrypted and that is plain now. A `ValidationError`, so a
 * route answers 400 with its sentence. It names neither the key nor the job, since a customer's
 * restore may end on it.
 */
export class EncryptionDowngradeError extends ValidationError {
    constructor() {
        super(
            "This backup was written encrypted, but the file at the destination is not encrypted. It may have been replaced there, so DBackup does not read it.",
            { field: "file" }
        );
    }
}

/** The path as the runner records it, without a leading slash or backslashes. */
function cleanPath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

interface RunDestination {
    configId?: unknown;
    path?: unknown;
    status?: unknown;
}

/** The record of one run for this destination and path, null when the run did not write it there or recorded nothing. */
function recordOf(row: { id: string; metadata: string | null }, destinationId: string, file: string): RecordedEncryption | null {
    if (!row.metadata) return null;
    let metadata: { archive?: { formatVersion?: unknown; encrypted?: unknown; profileId?: unknown }; destinations?: unknown };
    try {
        metadata = JSON.parse(row.metadata);
    } catch {
        return null;
    }
    const destinations = Array.isArray(metadata?.destinations) ? (metadata.destinations as RunDestination[]) : [];
    const wrote = destinations.some((destination) =>
        destination?.configId === destinationId
        && destination.status === "success"
        && typeof destination.path === "string"
        && cleanPath(destination.path) === file);
    if (!wrote) return null;
    // Only the seekable archive records its encryption. A run of an earlier format says nothing either way.
    const archive = metadata.archive;
    if (archive?.formatVersion !== 2 || typeof archive.encrypted !== "boolean") return null;
    return {
        encrypted: archive.encrypted,
        profileId: archive.encrypted && typeof archive.profileId === "string" ? archive.profileId : null,
        executionId: row.id,
    };
}

/**
 * What the newest run that wrote this file to this destination recorded about its encryption, null
 * when no run of History did or the run recorded nothing.
 *
 * @param viewerTenantId - The tenant whose view of the destination the path is in, whose runs wrote it. The tenant of the code that runs when left out
 */
export async function recordedEncryption(destinationId: string, file: string, viewerTenantId?: string | null): Promise<RecordedEncryption | null> {
    const clean = cleanPath(file);
    if (!clean) return null;
    const find = () => prisma.execution.findMany({
        // The runner records the path without a leading slash, older runs may have one.
        where: { type: "Backup", path: { in: [clean, `/${clean}`] } },
        orderBy: { startedAt: "desc" },
        take: RUNS_LOOKED_AT,
        select: { id: true, metadata: true },
    });
    const rows = await (viewerTenantId ? runAsTenant(viewerTenantId, find) : find());
    for (const row of rows) {
        const record = recordOf(row, destinationId, clean);
        if (record) return record;
    }
    return null;
}

/** What a reader found the backup to be, and the job its sidecar names for the warning. */
export interface FoundEncryption {
    encrypted: boolean;
    /** The job the `.meta.json` names. Only read for the warning about a backup without a record. */
    jobId?: unknown;
}

/**
 * Refuses a plain backup whose run wrote it encrypted, see `EncryptionDowngradeError`. Nothing to
 * check for an encrypted backup: no key opens a file the destination made up. A plain backup without
 * a record is read as before, with a warning in the log of the server when the job its sidecar names
 * encrypts now.
 *
 * @param viewerTenantId - See `recordedEncryption`
 */
export async function assertEncryptionKept(
    destinationId: string,
    file: string,
    found: FoundEncryption,
    viewerTenantId?: string | null
): Promise<void> {
    if (found.encrypted) return;
    const record = await recordedEncryption(destinationId, file, viewerTenantId);
    if (record) {
        if (record.encrypted) {
            log.warn("Refusing a plain backup that its run wrote encrypted", { destinationId, file, executionId: record.executionId });
            throw new EncryptionDowngradeError();
        }
        return;
    }
    if (typeof found.jobId !== "string" || found.jobId === "") return;
    const jobId = found.jobId;
    const lookup = () => prisma.job.findUnique({ where: { id: jobId }, select: { encryptionProfileId: true } });
    const job = await (viewerTenantId ? runAsTenant(viewerTenantId, lookup) : lookup()).catch(() => null);
    if (job?.encryptionProfileId) {
        log.warn("A plain backup without a run in History belongs to a job that encrypts now, it is read as it is", { destinationId, file, jobId });
    }
}
