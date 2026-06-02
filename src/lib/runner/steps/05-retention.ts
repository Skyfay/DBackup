import { RunnerContext, DestinationContext } from "../types";
import { RetentionService } from "@/services/backup/retention-service";
import { FileInfo } from '@/lib/core/interfaces';
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

    // Determine remote directory
    let remoteDir = `/${ctx.job!.name}`;
    if (dest.uploadResult?.path) {
        remoteDir = path.dirname(dest.uploadResult.path).replace(/\\/g, '/');
    }

    const files: FileInfo[] = await dest.adapter.list(dest.config, remoteDir);
    const backupFiles = files.filter(f => !f.name.endsWith('.meta.json'));

    // Check for locked files
    if (dest.adapter.read) {
        for (const file of backupFiles) {
            try {
                const metaContent = await dest.adapter.read(dest.config, file.path + ".meta.json");
                if (metaContent) {
                    const meta = JSON.parse(metaContent);
                    if (meta.locked) {
                        file.locked = true;
                    }
                }
            } catch (_e) {
                // Ignore read errors
            }
        }
    }

    const { keep, delete: filesToDelete } = RetentionService.calculateRetention(backupFiles, policy, timezone);
    ctx.log(`${destLabel} Retention: Keeping ${keep.length}, Deleting ${filesToDelete.length}.`);

    let deletedCount = 0;
    for (const file of filesToDelete) {
        ctx.log(`${destLabel} Retention: Deleting old backup ${file.name}...`);
        try {
            if (dest.adapter.delete) {
                await dest.adapter.delete(dest.config, file.path);
                const metaPath = file.path + ".meta.json";
                await dest.adapter.delete(dest.config, metaPath).catch(() => {});
                deletedCount++;
            }
        } catch (delError: unknown) {
            const message = delError instanceof Error ? delError.message : String(delError);
            ctx.log(`${destLabel} Retention Error deleting ${file.name}: ${message}`);
        }
    }

    return deletedCount;
}
