import os from "os";
import fs from "fs/promises";
import { RunnerContext } from "../types";
import { createTempDir, cleanupTempDir } from "@/lib/adapters/database/common/tar-utils";
import { createArchive } from "@/lib/archive/writer";
import { ArchiveSourceEntry, FileMetadata } from "@/lib/archive/types";
import { DIRECTORY_ONLY_SOURCE_TYPE, INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import { planChain, type ChainPlan } from "@/services/backup/chain-planner";
import { carryForward } from "@/lib/archive/chain";
import { resolveBackupFilename } from "./dump-helpers";
import { collectDirectories } from "./collect-directories";
import { dumpDatabases } from "./dump-databases";
import { formatBytes } from "@/lib/utils";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { PIPELINE_STAGES } from "@/lib/core/logs";

const log = logger.child({ step: "combined-dump" });

/**
 * Produces the backup of every job as one seekable archive (manifest v2).
 *
 * Each database is dumped on its own via dumpOne() and becomes its own entry, so a restore or
 * download of one database later reads only that entry. Directory sources, when the job has
 * any, are collected by collect-directories.ts and packed into the same archive. Incremental
 * chains only exist for jobs with directory sources: database dumps are always stored in full.
 */
export async function executeCombinedDump(ctx: RunnerContext): Promise<void> {
    if (!ctx.job) throw new Error("Context not initialized");
    const job = ctx.job;
    const hasDirectories = ctx.sources.length > 0;

    const sourceLabel = job.source ? `${job.source.name} (${job.source.type})` : "no database source";
    ctx.log(hasDirectories
        ? `Starting combined dump: ${sourceLabel} + ${ctx.sources.length} directory source(s)...`
        : `Starting dump from ${sourceLabel}...`);

    // Decide full vs incremental before anything is collected - it changes what has to be
    // transferred at all, and the naming template may want to place the chain position in
    // the filename, so the plan has to exist before the name is resolved. A job without
    // directory sources never builds a chain, whatever mode an earlier configuration left
    // stored on it, so it is never planned and carries no chain metadata.
    let plan: ChainPlan | undefined;
    if (hasDirectories) {
        plan = await planChain({
            job: {
                id: job.id,
                name: job.name,
                backupMode: (job as { backupMode?: string }).backupMode ?? "FULL",
                fullEveryDays: (job as { fullEveryDays?: number }).fullEveryDays ?? 7,
                encryptionProfileId: job.encryptionProfileId ?? null,
            },
            sources: ctx.sources.map((s) => ({ jobSourceId: s.jobSourceId, excludePatterns: s.excludePatterns })),
            destinationConfigIds: ctx.destinations.map((d) => d.configId),
            now: new Date(),
        });

        if (plan.type === "incremental") {
            ctx.log(`Incremental backup, continuing the chain started on ${plan.chainDir.replace("chain-", "")} (position ${plan.index})`);
        } else if (plan.reason) {
            ctx.log(`Full backup: ${plan.reason}`, 'warning');
        }
        ctx.chain = plan;
    }

    // The chain position is only part of the name for a job that actually builds chains; a
    // full-mode job resolves {chain} to nothing.
    const isChained = !!plan && ((job as { backupMode?: string }).backupMode ?? "FULL") === "INCREMENTAL";
    // The archive, its index and its metadata live in a directory of this run, which the
    // cleanup removes as a whole, whatever a step left in it.
    ctx.runDir = await createTempDir("dbackup-run-");
    const { tempFile, chainInFileName } = await resolveBackupFilename(
        job,
        isChained && plan ? { type: plan.type, index: plan.index } : undefined,
        ctx.runDir
    );
    ctx.tempFile = tempFile;
    ctx.chainInFileName = chainInFileName;
    ctx.log(`Prepared temporary path: ${tempFile}`);

    // Files whose bytes already live in an earlier archive of the chain. Collected while
    // walking the sources, then turned into carried index lines below.
    const carriedKeys = new Set<string>();
    // Only consulted for carried files - a re-stored one gets its metadata from the
    // SourceFileEntry the writer sees. Filled for every file anyway, because whether a file
    // ends up carried is not decided until its checksum is known.
    const freshMetadata = new Map<string, FileMetadata>();
    const previousBySource = new Map(
        (plan?.previousIndex?.directories ?? []).map((d) => [
            d.src,
            new Map((plan!.previousIndex!.files.filter((f) => f.src === d.src)).map((f) => [f.p, f])),
        ])
    );

    const workDir = await createTempDir("combined-dump-");
    const entries: ArchiveSourceEntry[] = [];
    let dbNames: string[] = [];
    let engineVersion: string | undefined;
    let engineEdition: string | undefined;

    try {
        // ── Databases (only if the job has a database source) ──────────────────────
        if (ctx.sourceAdapter && job.source) {
            if (hasDirectories && !ctx.sourceAdapter.dumpOne) {
                // Should already be blocked at job-create/update time (JobService); defensive check.
                throw new Error(`Database adapter '${job.source.adapterId}' does not support combined backups with directory sources`);
            }
            const dumped = await dumpDatabases(ctx, workDir);
            entries.push(...dumped.entries);
            dbNames = dumped.dbNames;
            engineVersion = dumped.engineVersion;
            engineEdition = dumped.engineEdition;
        }

        // ── Directory sources ──────────────────────────────────────────────────────
        // Collected in groups, which for every adapter that does not plan them means one
        // source per group and the same sequence as before. Files within a source are
        // downloaded in parallel; over a network source the per-file round trip dominates,
        // so that is where most of the collection time is won.
        if (hasDirectories && plan) {
            const collected = await collectDirectories({
                ctx,
                plan,
                verifyByHash: job.verifyByHash,
                workDir,
                previousBySource,
                // Each phase's progress is relative to its own work, filling its stage bar
                // independently of the database phase before it.
                setPhaseProgress: (done, total) => {
                    if (total === 0) return;
                    ctx.updateStageProgress(Math.min(100, Math.max(0, Math.round((done / total) * 100))));
                },
            });
            entries.push(...collected.entries);
            collected.carriedKeys.forEach((key) => carriedKeys.add(key));
            collected.freshMetadata.forEach((value, key) => freshMetadata.set(key, value));
        }

        // ── Pack everything into one archive ───────────────────────────────────────
        // Compression AND encryption are applied per entry inside the archive rather than as
        // whole-file passes in 03-upload.ts. That is what keeps the archive seekable: a single
        // entry can later be fetched by byte range and opened on its own, which a
        // compressed-or-encrypted outer stream would make impossible. 03-upload.ts skips both
        // of its own passes for this archive - see the isSeekableArchive guard there.
        const encryptionProfileId = job.encryptionProfileId ?? undefined;
        if (encryptionProfileId) {
            ctx.log(`Per-entry encryption enabled. Profile ID: ${encryptionProfileId}`);
        }

        // Packing compresses and encrypts every entry, which on a large source takes real
        // time. Without its own stage the run looked stuck at the end of the previous phase,
        // so it reports as its own step - the slot 03-upload leaves unused for this archive,
        // because both passes already happened here.
        ctx.setStage(PIPELINE_STAGES.PROCESSING);
        ctx.log(hasDirectories
            ? `Creating combined archive with ${dbNames.length} database(s) and ${ctx.sources.length} directory source(s)...`
            : `Creating archive with ${dbNames.length} database(s)...`);
        const { manifest, index, indexBytes, skippedCompression } = await createArchive(entries, tempFile, {
            sourceType: job.source ? job.source.adapterId : DIRECTORY_ONLY_SOURCE_TYPE,
            engineVersion,
            compression: (job.compression as "NONE" | "GZIP" | "BROTLI" | undefined) ?? "NONE",
            // Entries compress and encrypt ahead of the sequential tar write. This is local CPU
            // work, so it scales with cores rather than with anything a storage adapter allows -
            // and it is capped because the work is bursty and the machine is also running the
            // application. Falls back to 4 where the core count is unavailable.
            concurrency: Math.max(2, Math.min(8, os.cpus().length || 4)),
            onProgress: (done, total, label) => {
                ctx.updateStageProgress(Math.min(100, Math.round((done / total) * 100)));
                ctx.updateDetail(`Packing ${done}/${total}: ${label}`);
            },
            // A raw dump is not read again once it is in the archive. Removing it right away
            // keeps a multi-database job from holding every raw dump and the finished archive
            // on disk at the same time.
            onDatabaseDumpWritten: (localPath) => fs.unlink(localPath).catch(() => { }),
            ...(ctx.abortSignal ? { signal: ctx.abortSignal } : {}),
            ...(encryptionProfileId
                ? { encryption: { masterKey: await getProfileMasterKey(encryptionProfileId), profileId: encryptionProfileId } }
                : {}),
            ...(plan
                ? {
                    chain: {
                        id: plan.chainId,
                        type: plan.type,
                        ...(plan.baseArchive ? { base: plan.baseArchive } : {}),
                        index: plan.index,
                        ...(plan.previousIndex && plan.baseArchive
                            ? { carried: carryForward(plan.previousIndex, plan.baseArchive, carriedKeys, freshMetadata) }
                            : {}),
                    },
                }
                : {}),
        });

        // Said out loud, because otherwise a job configured for compression that produces an
        // archive roughly the size of its input reads like a setting that did not apply.
        if (skippedCompression.files > 0) {
            ctx.log(
                `${skippedCompression.files} file(s) stored uncompressed (${formatBytes(skippedCompression.bytes)}) - their format is already compressed`
            );
        }

        // The sidecar is a byte-identical copy of the archive's own index member. Uploading
        // it separately is what lets browsing, restore and download read the table of
        // contents without pulling the archive down.
        ctx.indexFile = tempFile + INDEX_SIDECAR_SUFFIX;
        await fs.writeFile(ctx.indexFile, indexBytes);
        ctx.log(hasDirectories
            ? `Wrote archive index sidecar (${formatBytes(indexBytes.length)}, ${manifest.counts.files} file(s))`
            : `Wrote archive index sidecar (${formatBytes(indexBytes.length)})`);

        // The complete snapshot size, including files whose bytes live in earlier
        // archives of the chain. manifest.totalSize only covers what this archive stores.
        const logicalSize =
            index.files.reduce((sum, f) => sum + f.s, 0) +
            index.databases.reduce((sum, d) => sum + d.s, 0);

        // What the backup occupies on the destination. The manifest's total is the plaintext
        // size of every entry, which for a compressed backup is far larger than the file.
        ctx.dumpSize = (await fs.stat(tempFile)).size;
        ctx.metadata = {
            ...ctx.metadata,
            jobName: job.name,
            sourceName: job.source?.name,
            sourceType: job.source?.adapterId,
            adapterId: job.source?.adapterId,
            engineVersion,
            engineEdition,
            count: dbNames.length,
            names: dbNames,
            label: hasDirectories
                ? (dbNames.length > 0 ? `${dbNames.length} DB(s) + ${ctx.sources.length} directory source(s)` : `${ctx.sources.length} directory source(s)`)
                : (dbNames.length === 1 ? "Single DB" : `${dbNames.length} DBs`),
            // Only a backup with directory sources records this. Its absence is what tells the
            // explorer and the restore page that a seekable archive holds databases alone.
            ...(hasDirectories
                ? { combined: { databases: dbNames.length, directorySources: ctx.sources.length } }
                : {}),
            logicalSize,
            archive: {
                formatVersion: 2 as const,
                indexFile: INDEX_SIDECAR_SUFFIX,
                encrypted: !!manifest.encryption,
                ...(manifest.encryption
                    ? {
                        profileId: manifest.encryption.profileId,
                        kdfSalt: manifest.encryption.kdfSalt,
                        noncePrefix: manifest.encryption.noncePrefix,
                    }
                    : {}),
                ...(manifest.compression !== "NONE" ? { compression: manifest.compression } : {}),
                ...(manifest.bundled ? { bundled: true } : {}),
                files: manifest.counts.files,
            },
        };

        ctx.log(`${hasDirectories ? "Combined archive" : "Archive"} created successfully. Size: ${formatBytes(ctx.dumpSize)}`, 'success');
    } finally {
        await cleanupTempDir(workDir).catch((e) => log.warn("Failed to clean up combined-dump work directory", { workDir }, wrapError(e)));
    }
}
