import { RunnerContext, DestinationContext } from "../types";
import { RetentionService } from "@/services/backup/retention-service";
import { FileInfo } from '@/lib/core/interfaces';
import { isBackupFile, sidecarPathsFor } from '@/lib/core/backup-files';
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
    const backupFiles = files.filter(f => isBackupFile(f.name));

    // Read each backup's sidecar for its lock flag and chain membership. The chain id is
    // what lets retention treat an incremental chain as one indivisible unit.
    if (dest.adapter.read) {
        for (const file of backupFiles) {
            try {
                const metaContent = await dest.adapter.read(dest.config, file.path + ".meta.json");
                if (metaContent) {
                    const meta = JSON.parse(metaContent);
                    if (meta.locked) {
                        file.locked = true;
                    }
                    if (meta.chain?.id) {
                        file.chainId = meta.chain.id;
                    }
                }
            } catch (_e) {
                // Ignore read errors
            }
        }
    }

    // Log each file with its timestamp so adapter-level timestamp issues are immediately visible.
    const sorted = [...backupFiles].sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    for (const f of sorted) {
        ctx.log(`${destLabel} Retention: Found file: ${f.name} (${f.lastModified.toISOString()})`);
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
        ctx.log(`${destLabel} Retention: Deleting old backup ${file.name}...`);
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
