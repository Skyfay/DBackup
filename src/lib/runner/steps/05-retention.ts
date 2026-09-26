import { RunnerContext, DestinationContext } from "../types";
import { RetentionService } from "@/services/backup/retention-service";
import { FileInfo } from '@/lib/core/interfaces';
import { isBackupFile, sidecarPathsFor, effectiveBackupTime } from '@/lib/core/backup-files';
import { loadBackupSidecars } from './retention-sidecars';
import { folderKey, loadFormerBackups } from './retention-folders';
import path from "path";
import { logger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";

const log = logger.child({ step: "05-retention" });

export async function stepRetention(ctx: RunnerContext) {
    if (!ctx.job || ctx.destinations.length === 0) throw new Error("Context not ready for retention");

    const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
    const timezone = tzSetting?.value || 'UTC';

    let totalDeleted = 0;

    for (const dest of ctx.destinations) {
        // Only apply retention to destinations that had a successful upload
        if (!dest.uploadResult?.success) {
            ctx.log(`[${dest.configName}] Retention: Skipped (upload was not successful)`);
            continue;
        }

        await applyRetentionForDestination(ctx, dest, timezone).then(deleted => {
            totalDeleted += deleted;
        }).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            ctx.log(`[${dest.configName}] Retention Process Error: ${message}`, 'error');
        });
    }

    // Refresh storage stats cache after retention deletes files (non-blocking)
    if (totalDeleted > 0) {
        import("@/services/dashboard-service").then(({ refreshStorageStatsCache }) => {
            refreshStorageStatsCache().catch((e) => {
                log.warn("Failed to refresh storage stats cache after retention", {}, e instanceof Error ? e : undefined);
            });
        });
    }
}


async function applyRetentionForDestination(ctx: RunnerContext, dest: DestinationContext, timezone: string): Promise<number> {
    const destLabel = `[${dest.configName}]`;
    const policy = dest.retention;

    if (!policy || policy.mode === 'NONE') {
        ctx.log(`${destLabel} Retention: No policy configured. Skipping.`);
        return 0;
    }

    const policyDetails = (() => {
        if (dest.retentionPolicyName) {
            if (dest.retentionPolicySource === 'default') {
                return `${policy.mode} (default template: ${dest.retentionPolicyName})`;
            }
            return `${policy.mode} (template: ${dest.retentionPolicyName})`;
        }

        if (dest.retentionPolicySource === 'legacy') {
            return `${policy.mode} (legacy inline policy)`;
        }

        return policy.mode;
    })();

    ctx.log(`${destLabel} Retention: Applying policy ${policyDetails}...`);

    if (!dest.adapter.list) {
        ctx.log(`${destLabel} Retention warning: Storage adapter does not support listing files. Skipped.`);
        return 0;
    }

    // Determine remote directory.
    //
    // For an incremental job the uploaded archive sits inside its chain's own folder, so
    // the directory to scan is one level up - otherwise retention would only ever see the
    // current chain and no old chain would ever be deleted. Both list() implementations
    // that matter here are recursive, so the chain subfolders are still found.
    let remoteDir = `/${ctx.job!.name}`;
    if (dest.uploadResult?.path) {
        const uploadDir = path.dirname(dest.uploadResult.path).replace(/\\/g, '/');
        remoteDir = ctx.chain && ctx.job!.backupMode === "INCREMENTAL"
            ? path.dirname(uploadDir).replace(/\\/g, '/')
            : uploadDir;
    }

    const files: FileInfo[] = await dest.adapter.list(dest.config, remoteDir);
    const listed = files.filter(f => isBackupFile(f.name));

    // Each backup's sidecar carries its lock flag, its chain membership, the job that made it
    // and the time DBackup recorded when it wrote the backup. The chain id is what lets
    // retention treat an incremental chain as one indivisible unit, and the timestamp is what
    // it buckets by.
    const sidecars = await loadBackupSidecars(dest.adapter, dest.config, files, listed);

    // A backup whose sidecar names another job is not this job's to delete. A job named like a
    // deleted one writes into the same folder, and what the deleted job left there stays until
    // someone deletes it in the Storage Explorer. A backup without a sidecar or a job id counts
    // as this job's, as it always did, so this only ever keeps more.
    const jobId = ctx.job!.id;
    const foreign = listed.filter(f => f.jobId !== undefined && f.jobId !== jobId);
    const current = listed.filter(f => f.jobId === undefined || f.jobId === jobId);
    if (foreign.length > 0) {
        ctx.log(
            `${destLabel} Retention: ${foreign.length} backup(s) in this folder belong to another job and are left alone: ${foreign.map(f => f.name).join(', ')}`,
            'info'
        );
    }

    // A renamed job left its earlier backups in the folder of its old name. The policy covers
    // them too, so they go when it says, instead of staying there forever.
    const former = await loadFormerBackups(dest.adapter, dest.config, dest.configId, jobId, remoteDir, new Set(files.map(f => folderKey(f.path))));
    for (const { folder, count } of former.folders) {
        ctx.log(`${destLabel} Retention: Also judging ${count} backup(s) this job left in ${folder}/ before it was renamed.`);
    }
    const backupFiles = [...current, ...former.files];
    const own = new Set(backupFiles);
    const drifted = [...sidecars.drifted, ...former.drifted];
    const formerFiles = new Set(former.files);
    const labelOf = (file: FileInfo) => (formerFiles.has(file) ? folderKey(file.path) : file.name);

    if (backupFiles.length > 0) {
        const withTimestamp = backupFiles.filter(f => f.backupTimestamp).length;
        ctx.log(
            `${destLabel} Retention: ${withTimestamp} of ${backupFiles.length} backup(s) supplied their own creation time, the rest fall back to the file's modification time on the destination.`
        );
    }
    // A destination whose modification times were reset, by a copy without -p or by a
    // restore of the backup directory, would otherwise collapse into one bucket without
    // anyone noticing until backups were already gone.
    for (const { file, recorded, modified } of drifted) {
        if (!own.has(file)) continue;
        ctx.log(
            `${destLabel} Retention: ${file.name} was written ${recorded.toISOString()} but the destination reports ${modified.toISOString()}. Retention uses the recorded time.`,
            'warning'
        );
    }

    // Log each file with the time it is actually judged by, so a bucketing surprise can be
    // traced without guessing which of the two times was used.
    const sorted = [...backupFiles].sort(
        (a, b) => effectiveBackupTime(b).getTime() - effectiveBackupTime(a).getTime()
    );
    for (const f of sorted) {
        const effective = effectiveBackupTime(f);
        const mtimeNote = effective.getTime() === f.lastModified.getTime()
            ? ''
            : ` (mtime ${f.lastModified.toISOString()})`;
        ctx.log(`${destLabel} Retention: Found file: ${labelOf(f)} (${effective.toISOString()})${mtimeNote}`);
    }

    const { keep, delete: filesToDelete, keptForChain } = RetentionService.calculateRetention(backupFiles, policy, timezone);

    const chainCount = new Set(backupFiles.map(f => f.chainId).filter(Boolean)).size;
    if (chainCount > 0) {
        ctx.log(`${destLabel} Retention: ${chainCount} incremental chain(s) present - a chain is only deleted once all of its snapshots expire.`);
    }
    // Named individually, because "why are there more backups here than my policy allows"
    // is otherwise unanswerable from the outside. These are held back by their chain, not
    // by the policy, and they go as soon as the chain's newest snapshot expires.
    if (keptForChain.length > 0) {
        ctx.log(
            `${destLabel} Retention: ${keptForChain.length} backup(s) past the policy are kept because their chain is still in use: ${keptForChain.map(f => f.name).join(', ')}`,
            'info'
        );
    }
    ctx.log(`${destLabel} Retention: Keeping ${keep.length}, Deleting ${filesToDelete.length}.`);

    let deletedCount = 0;
    for (const file of filesToDelete) {
        ctx.log(`${destLabel} Retention: Deleting old backup ${labelOf(file)}...`);
        try {
            if (dest.adapter.delete) {
                await dest.adapter.delete(dest.config, file.path);
                // Every sidecar goes with it, otherwise orphans accumulate and later
                // confuse listings and storage statistics.
                for (const sidecar of sidecarPathsFor(file.path)) {
                    await dest.adapter.delete(dest.config, sidecar).catch(() => {});
                }
                deletedCount++;
                import("@/services/storage/storage-service").then(({ storageService }) => {
                    storageService.removeStorageListCacheEntry(dest.configId, file.path).catch(() => {});
                });
            }
        } catch (delError: unknown) {
            const message = delError instanceof Error ? delError.message : String(delError);
            ctx.log(`${destLabel} Retention Error deleting ${file.name}: ${message}`);
        }
    }

    return deletedCount;
}
