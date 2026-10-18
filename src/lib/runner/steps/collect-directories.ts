/**
 * Collects the directory sources of one run.
 *
 * Split out of combined-dump.ts, which owns the database dumps and the archive, and had
 * grown past the point where either half could be read on its own. Nothing about the
 * collection itself changed in the move.
 *
 * Sources are collected in groups (see source-groups.ts). For every adapter that does not
 * plan groups - which today is all of them - a group holds exactly one source and this runs
 * exactly as it did before groups existed.
 */

import path from "path";
import os from "os";
import type { ChainPlan } from "@/services/backup/chain-planner";
import type { RunnerContext, DirectorySourceContext } from "../types";
import type { IndexFileLine } from "@/lib/archive/types";
import type { SnapshotHandle } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { ArchiveSourceEntry, FileMetadata, SourceFileEntry } from "@/lib/archive/types";
import { downloadDirectory } from "@/lib/adapters/storage/common/download-directory";
import { fileKey } from "@/lib/archive/chain";
import { formatBytes } from "@/lib/utils";
import { calculateFileChecksum } from "@/lib/crypto/checksum";
import { PIPELINE_STAGES } from "@/lib/core/logs";
import { resolveTransferConcurrency } from "@/lib/adapters/transfer-concurrency";
import { mapWithConcurrency } from "@/lib/concurrency";
import { planCollectionGroups, type CollectionGroup } from "./source-groups";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { assertTenantReach } from "@/services/tenant/tenant-network";

/**
 * How many collected files are hashed at once.
 *
 * A mix of disk reads and SHA-256, so it scales with cores, and it is capped for the same
 * reason the archive writer caps its own: the work is bursty and the machine is also serving
 * the application.
 */
const HASH_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length || 4));

/** How often the hashing phase refreshes its progress text. */
const HASH_PROGRESS_EVERY = 25;

/** What an adapter is handed to write into the run's log. Same shape as everywhere else. */
type SnapshotLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

export interface CollectDirectoriesInput {
    ctx: RunnerContext;
    /** Decides whether unchanged files may be skipped, and against which snapshot. */
    plan: ChainPlan;
    /** Hash every file instead of trusting size and mtime. */
    verifyByHash: boolean;
    /** Root the collected trees are written under. */
    workDir: string;
    /** Previous snapshot's file lines per source, for the incremental skip decision. */
    previousBySource: Map<string, Map<string, IndexFileLine>>;
    /** Advances the shared collect-phase bar. Databases fill the dump bar the same way. */
    setPhaseProgress: (done: number, total: number) => void;
}

export interface CollectDirectoriesResult {
    entries: ArchiveSourceEntry[];
    /** Files whose bytes already live in an earlier archive of the chain. */
    carriedKeys: Set<string>;
    /** Permissions and ownership as the sources report them now, by fileKey(). */
    freshMetadata: Map<string, FileMetadata>;
}

export async function collectDirectories(input: CollectDirectoriesInput): Promise<CollectDirectoriesResult> {
    const { ctx, plan, verifyByHash, workDir, previousBySource, setPhaseProgress } = input;

    const entries: ArchiveSourceEntry[] = [];
    const carriedKeys = new Set<string>();
    const freshMetadata = new Map<string, FileMetadata>();

    const dirTotal = ctx.sources.length;
    if (dirTotal === 0) return { entries, carriedKeys, freshMetadata };

    ctx.setStage(PIPELINE_STAGES.COLLECTING);

    // Planned before anything is collected: an adapter that groups has to see the whole run
    // to decide, and a bad partition must fail the job before a single byte moves.
    const groups = await planCollectionGroups(ctx.sources);

    let dirDone = 0;
    for (const [index, group] of groups.entries()) {
        // Checked before the snapshot, so a cancelled run never creates a snapshot it then
        // has to release.
        ctx.abortSignal?.throwIfAborted();

        // Only the runner knows how the run is carved up, so it says so. Which containers a
        // group takes down and what it reads through is the adapter's story, told below.
        // Said only when there is more than one, since "Group 1 of 1" is noise.
        if (groups.length > 1) {
            ctx.log(
                `[${group.sources[0].configName}] Group ${index + 1} of ${groups.length}: `
                + group.sources.map((s) => s.remotePath || "/").join(", "),
                'info', 'storage'
            );
        }

        const prepared = await acquireGroupSnapshot(ctx, group);
        try {
            for (const source of group.sources) {
                ctx.abortSignal?.throwIfAborted();
                await collectOne({
                    ctx, plan, verifyByHash, workDir, previousBySource,
                    source,
                    readConfig: prepared.readConfig,
                    unitBase: dirDone,
                    dirTotal,
                    setPhaseProgress,
                    entries, carriedKeys, freshMetadata,
                });
                dirDone++;
                setPhaseProgress(dirDone, dirTotal);
            }
        } finally {
            // Released here rather than only in stepCleanup, so whatever the preparation
            // holds open is given back as soon as this group is done instead of at the end
            // of the run. The handle stays registered on the context either way, and
            // releaseSnapshot has to tolerate one that is already gone - so a run that dies
            // mid-group is still cleaned up by stepCleanup exactly as before.
            await prepared.release();
        }
    }

    return { entries, carriedKeys, freshMetadata };
}

interface CollectOneInput extends Omit<CollectDirectoriesInput, "ctx"> {
    ctx: RunnerContext;
    source: DirectorySourceContext;
    /** The group's config, overlaid with the snapshot when there is one. */
    readConfig: Record<string, unknown>;
    /** Sources already finished, so this one's progress continues rather than restarts. */
    unitBase: number;
    dirTotal: number;
    entries: ArchiveSourceEntry[];
    carriedKeys: Set<string>;
    freshMetadata: Map<string, FileMetadata>;
}

async function collectOne(input: CollectOneInput): Promise<void> {
    const {
        ctx, plan, verifyByHash, workDir, previousBySource, source, readConfig,
        unitBase, dirTotal, setPhaseProgress, entries, carriedKeys, freshMetadata,
    } = input;

    const displayPath = source.remotePath || "/";
    const label = `${source.configName}: ${displayPath}`;
    const logPrefix = `[Directory: ${displayPath} via ${source.configName}]`;
    ctx.log(`${logPrefix} Starting collection...`, 'info', 'storage');
    // Said before anything slow starts. The detail text is otherwise still the previous
    // source's final count, and a run that has moved on looks like a run that has stopped.
    ctx.updateDetail(`${label}: preparing...`);

    const localDir = path.join(workDir, "sources", source.jobSourceId);

    // Incremental runs skip files the chain already holds. The decision uses the listing
    // (size and mtime), so an unchanged file is never transferred - which is where the
    // bandwidth saving comes from, on top of the storage saving.
    //
    // Any difference in the timestamp counts, not just a newer one: a file whose mtime moves
    // backwards has still been replaced - restoring an older copy or a corrected clock on the
    // source both do that - and treating it as unchanged would silently keep the stale
    // version. Erring this way costs one needless transfer at worst, which is the direction
    // to err in. Matches rsync's quick check, which compares size and mtime for inequality.
    //
    // A full backup sets no predicate at all, so everything is transferred and hashed. That
    // bounds how long a missed change can survive: at most until the next full, which is what
    // "Full backup every N days" controls.
    const previousFiles = previousBySource.get(source.jobSourceId);
    const shouldDownload = plan.type === "incremental" && previousFiles && !verifyByHash
        ? (entry: { relativePath: string; size: number; lastModified: Date }) => {
            const before = previousFiles.get(entry.relativePath);
            if (!before) return true;
            if (before.s !== entry.size) return true;
            return entry.lastModified.getTime() !== new Date(before.m).getTime();
        }
        : undefined;

    const result = await downloadDirectory(
        source.adapter,
        readConfig,
        source.remotePath,
        localDir,
        source.excludePatterns,
        (processedBytes, totalBytes, processedFiles, totalFiles) => {
            const localFraction = totalBytes > 0
                ? processedBytes / totalBytes
                : (totalFiles > 0 ? processedFiles / totalFiles : 0);
            setPhaseProgress(unitBase + localFraction, dirTotal);
            // Not every source knows both totals up front. A container volume counts its
            // files cheaply but cannot add up their sizes without reading them, and a source
            // that could not even be counted knows neither. A total shown as zero reads as a
            // bug, so whichever half is unknown is left out rather than printed as "/0".
            const filePart = totalFiles > 0 ? `${processedFiles}/${totalFiles} files` : `${processedFiles} file(s)`;
            const bytePart = totalBytes > 0
                ? `${formatBytes(processedBytes)}/${formatBytes(totalBytes)}`
                : formatBytes(processedBytes);
            ctx.updateDetail(`${label}: ${filePart}, ${bytePart}`);
        },
        (msg, level, type, details) => ctx.log(`${logPrefix} ${msg}`, level, type ?? 'storage', details),
        {
            concurrency: resolveTransferConcurrency(source.adapter.id, readConfig),
            ...(shouldDownload ? { shouldDownload } : {}),
            ...(ctx.abortSignal ? { signal: ctx.abortSignal } : {}),
            // Only the detail text, deliberately. During listing there is no denominator yet,
            // so the stage bar has nothing honest to say and stays where the previous source
            // left it.
            onListProgress: ({ files, directories, prunedDirectories }) => ctx.updateDetail(
                `${label}: scanning, ${files} file(s) in ${directories} director(ies)`
                + (prunedDirectories > 0 ? `, ${prunedDirectories} skipped` : '')
            ),
        }
    );

    // A file the source would not hand over is missing from this backup. Naming each one and
    // refusing to call the run a success is the whole point - a silently incomplete backup is
    // the failure mode that only shows up when it is needed.
    if (result.failures.length > 0) {
        for (const failure of result.failures) {
            ctx.log(`${logPrefix} MISSING from this backup: ${failure.path} (${failure.error})`, 'error', 'storage');
        }
        ctx.log(
            `${logPrefix} ${result.failures.length} file(s) could not be collected and are not in this backup`,
            'error', 'storage'
        );
        ctx.status = "Partial";
    }

    for (const e of result.entries) {
        // A symbolic link has no bytes anywhere to point back at, so it is never carried -
        // every snapshot restates its links in full. Guarded even though the collection never
        // marks one unchanged, because the cost of being wrong here is a link that silently
        // disappears from an incremental.
        if (e.linkTarget !== undefined) continue;
        // Not transferred, so its bytes stay where they already are.
        if (e.unchanged) carriedKeys.add(fileKey(source.jobSourceId, e.relativePath));
    }

    // Permissions and ownership as the source sees them right now, for every file regardless
    // of whether its bytes move. A file whose mode changed but whose content did not is
    // carried forward, and this is what stops the chain from replaying the mode it had when
    // the bytes were last written.
    for (const e of result.entries) {
        if (e.mode === undefined && e.uid === undefined && e.gid === undefined) continue;
        freshMetadata.set(fileKey(source.jobSourceId, e.relativePath), {
            mode: e.mode, uid: e.uid, gid: e.gid,
        });
    }

    // Content hash of the raw (pre-compression, pre-encryption) file. Lands in the archive
    // index, which is itself sealed when the job is encrypted - a plaintext hash sitting in
    // the clear would be a confirmation oracle against known files.
    //
    // Hashing is a second full read of everything just collected. Done one file at a time
    // with nothing reported, it left the run looking finished-but-frozen for as long as the
    // source was large - the last silent stretch of the collect phase.
    //
    // Symbolic links are left out: nothing was collected under their path, so hashing one
    // means reading a file that is not there. Their content is the target string, which the
    // index already carries in full.
    const toHash = result.entries.filter((e) => !e.unchanged && e.linkTarget === undefined);
    let hashed = 0;
    ctx.updateDetail(`${label}: hashing ${toHash.length} file(s)...`);
    const checksums = await mapWithConcurrency(toHash, HASH_CONCURRENCY, async (e) => {
        ctx.abortSignal?.throwIfAborted();
        const checksum = await calculateFileChecksum(path.join(localDir, e.relativePath));
        hashed++;
        if (hashed % HASH_PROGRESS_EVERY === 0) {
            ctx.updateDetail(`${label}: hashing ${hashed}/${toHash.length} file(s)`);
        }
        return checksum;
    });

    // Rebuilt in listing order, which mapWithConcurrency preserves - the index is compared
    // against the previous snapshot's, so its layout has to stay stable.
    const fileIndex: SourceFileEntry[] = [];
    toHash.forEach((e, i) => {
        const before = previousFiles?.get(e.relativePath);
        const checksum = checksums[i];

        // The file was transferred, but its content is identical to what the chain already
        // holds - mtime moved without the bytes changing, which happens on every deploy and
        // every `touch`. Carrying it forward avoids storing a second copy of the same content.
        if (before?.h && before.h === checksum) {
            carriedKeys.add(fileKey(source.jobSourceId, e.relativePath));
            return;
        }

        fileIndex.push({
            path: e.relativePath,
            size: e.size,
            mtime: e.lastModified.toISOString(),
            checksum,
            mode: e.mode,
            uid: e.uid,
            gid: e.gid,
        });
    });

    // Restated in every snapshot, full or incremental. A link is a path string of a few dozen
    // bytes, so carrying it forward would save nothing and cost the entire chain a special
    // case in exchange.
    const symlinkEntries = result.entries.filter((e) => e.linkTarget !== undefined);
    for (const e of symlinkEntries) {
        fileIndex.push({
            path: e.relativePath,
            size: 0,
            mtime: e.lastModified.toISOString(),
            linkTarget: e.linkTarget,
        });
    }

    if (plan.type === "incremental") {
        const carriedHere = result.entries.length - fileIndex.length;
        ctx.log(
            `${logPrefix} ${fileIndex.length} changed file(s) stored, ${carriedHere} unchanged file(s) referenced from earlier backups`,
            'info', 'storage'
        );
    }

    entries.push({
        kind: "directory",
        jobSourceId: source.jobSourceId,
        label,
        localPath: localDir,
        excludePatterns: source.excludePatterns,
        files: fileIndex,
    });

    // Links are counted apart from files rather than folded in. They restore to something
    // entirely different, and a run that stored 18 of them should say so where anyone reading
    // the history will see it.
    const symlinkSuffix = symlinkEntries.length > 0
        ? ` and ${symlinkEntries.length} symlink(s)`
        : '';
    ctx.log(
        `${logPrefix} Collected ${result.files - symlinkEntries.length} file(s)${symlinkSuffix}, ${formatBytes(result.bytes)}`,
        'success', 'storage'
    );
}

/**
 * Refuses the config a snapshot hands back when the connection of a customer may not read it,
 * the checks `resolveAdapterConfig` runs for the configured one.
 */
async function assertSnapshotReach(tenantId: string | undefined, adapterId: string, config: Record<string, unknown>): Promise<void> {
    if (!tenantId || tenantId === HOME_TENANT_ID) return;
    const reason = hostLocalReason(adapterId, config);
    if (reason) throw new Error(reason);
    await assertTenantReach(tenantId, adapterId, config);
}

interface PreparedGroup {
    /** What the collection reads through: the plain config, or one overlaid with a snapshot. */
    readConfig: Record<string, unknown>;
    /** Idempotent, and safe to call even when nothing was prepared. */
    release: () => Promise<void>;
}

/**
 * Prepares a group for reading, when its adapter needs or was asked for a snapshot.
 *
 * Throws when a source is configured for snapshots but cannot get one. That is deliberate: a
 * job that promises point-in-time consistency must not quietly produce a backup without it.
 * The failure is loud, and the job's failure notification carries it.
 *
 * The handle is parked on the context immediately, before anything else can fail, so
 * stepCleanup releases it no matter how the run ends.
 */
async function acquireGroupSnapshot(ctx: RunnerContext, group: CollectionGroup): Promise<PreparedGroup> {
    // Every member of a group shares one adapter config, so the first source speaks for it.
    const source = group.sources[0];
    const { adapter, config } = source;
    const displayPath = source.remotePath || "/";
    const logPrefix = `[Directory: ${displayPath} via ${source.configName}]`;

    // What this adapter's preparation is called. A shadow copy and a helper container are
    // not the same thing, and a log that calls one by the other's name is worse than a vague
    // one. Only known once a handle exists, so the pre-create lines stay generic.
    const nounOf = (handle?: SnapshotHandle) => handle?.noun ?? "snapshot";

    // The adapter's own voice in the execution log. Preparing a source is often the most
    // consequential thing a backup does - stopping a database, finding services an earlier
    // run left down - and without this none of it reached the history.
    const say: SnapshotLog = (msg, level, type, details) =>
        ctx.log(`${logPrefix} ${msg}`, level, type ?? 'storage', details);

    const wanted = adapter.alwaysSnapshot === true || config?.useVss === true;
    if (!wanted) return { readConfig: config, release: async () => { } };

    if (!adapter.createSnapshot || !adapter.supportsSnapshot || !adapter.releaseSnapshot) {
        throw new Error(`${source.configName}: this source has to be read from a snapshot, but adapter '${adapter.id}' cannot create one`);
    }

    const support = await adapter.supportsSnapshot(config, source.remotePath);
    if (!support.supported) {
        throw new Error(`${source.configName}: this source has to be read from a snapshot, which is unavailable - ${support.message}`);
    }

    // A run killed before cleanup leaves its snapshot behind, and the server refuses a new
    // one while the old set is open. Clear those first or every later backup fails.
    if (adapter.findOrphanedSnapshots) {
        const orphans = await adapter.findOrphanedSnapshots(config, source.remotePath).catch(() => []);
        for (const orphan of orphans) {
            ctx.log(`${logPrefix} Removing a ${nounOf(orphan)} left over from an earlier run (${orphan.label})`, 'warning', 'storage');
            await adapter.releaseSnapshot(config, orphan, say).catch((e: unknown) => {
                ctx.log(`${logPrefix} Could not remove the leftover ${nounOf(orphan)}: ${e instanceof Error ? e.message : String(e)}`, 'warning', 'storage');
            });
        }
    }

    // Uniform across a group by construction: a source that opts out of stopping is always
    // planned into a group of its own, so there is no half-and-half case to reconcile.
    const handle = await adapter.createSnapshot(
        config,
        group.sources.map((s) => s.remotePath),
        { stopContainers: source.stopContainers ?? true, onLog: say },
    );

    const record = {
        configId: source.configId,
        configName: source.configName,
        adapter,
        config,
        handle,
        released: false,
    };
    ctx.shadowCopies = ctx.shadowCopies ?? [];
    ctx.shadowCopies.push(record);

    // What a snapshot hands back, like the share a file server exposes a shadow copy under, is
    // read like the configured connection: never the server DBackup runs on for a customer, and
    // not the local network its tenant blocks. The handle is parked above, so stepCleanup releases it.
    const readConfig = { ...config, ...handle.configOverride };
    if (Object.keys(handle.configOverride ?? {}).length > 0) {
        await assertSnapshotReach(source.tenantId, adapter.id, readConfig);
    }
    ctx.log(`${logPrefix} Reading from ${nounOf(handle)} ${handle.label}`, 'info', 'storage');

    return {
        readConfig,
        release: async () => {
            if (record.released) return;
            try {
                await adapter.releaseSnapshot!(config, handle, say);
                // Only a release that worked counts. A failed one stays unmarked so
                // stepCleanup tries again at the end of the run.
                record.released = true;
                ctx.log(`${logPrefix} Released the ${nounOf(handle)}`, 'info', 'storage');
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                ctx.log(
                    `${logPrefix} Could not release the ${nounOf(handle)} yet (${handle.label}): ${message}. Retrying at the end of the run.`,
                    'warning', 'storage'
                );
            }
        },
    };
}
