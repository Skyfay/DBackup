import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import { RetentionService } from "@/services/retention-service";
import { RetentionConfiguration, DEFAULT_RETENTION_CONFIG } from "@/lib/core/retention";
import { FileInfo } from '@/lib/core/interfaces';

export async function stepRetention(ctx: RunnerContext) {
    if (!ctx.job || !ctx.destAdapter) throw new Error("Context not ready for retention");

    // 1. Check if retention is configured
    // Since job is typed as prisma model, retention is a string
    const retentionJson = (ctx.job as any).retention as string;

    if (!retentionJson || retentionJson === '{}') {
        ctx.log("Retention: No policy configured. Skipping.");
        return;
    }

    let policy: RetentionConfiguration;
    try {
        policy = JSON.parse(retentionJson);
    } catch (e) {
        ctx.log("Retention: Failed to parse configuration. Skipping.");
        return;
    }

    if (policy.mode === 'NONE') {
        ctx.log("Retention: Policy mode is NONE. Skipping.");
        return;
    }

    ctx.log(`Retention: Applying policy ${policy.mode}...`);

    try {
        // 2. List all files in destination
        // We need to implement listFiles in StorageAdapter interface first?
        // Wait, the StorageAdapter interface in interfaces.ts doesn't have listFiles defined in the snippet I saw earlier.
        // Let's check if the adapter implementation supports listing or if we need to add it.
        // Based on typical backup managers, we list files, filter by job prefix if necessary.

        // For now, I'll assume we might need to extend the interface or check how to list.
        // But usually, listing is needed for "Restore" page as well.
        // Let's assume listFiles exists or we need to add it.
        // Checking `src/lib/core/interfaces.ts` earlier showed `download`, `upload`.
        // I need to check if `listFiles` exists on `StorageAdapter`.

if (!ctx.destAdapter.list) {
             ctx.log("Retention warning: Storage adapter does not support listing files. Retention skipped.");
             return;
        }

        const destConfig = await decryptConfig(ctx.job.destination.config);

        // List files in the job directory
        // The job usually stores files in `/${job.name}/` or similar.
        // In `03-upload.ts`, `remotePath` is `/${job.name}/${fileName}`.
        const remoteDir = `/${ctx.job.name}`;

        const files: FileInfo[] = await ctx.destAdapter.list(destConfig, remoteDir);

        // Filter only relevant files (maybe just .sql, .gz, etc? or trust the folder isolation)
        // Usually folder isolation `/${job.name}` is enough.

        // 3. Calculate Deletion
        const { delete: filesToDelete, keep } = RetentionService.calculateRetention(files, policy);

        ctx.log(`Retention: Found ${files.length} total backups.`);
        ctx.log(`Retention: Keeping ${keep.length}, Deleting ${filesToDelete.length}.`);

        // 4. Delete files
        for (const file of filesToDelete) {
             ctx.log(`Retention: Deleting old backup ${file.name}...`);
             try {
                if (ctx.destAdapter.delete) {
                    await ctx.destAdapter.delete(destConfig, file.path);
                } else {
                    ctx.log(`Retention warning: Storage adapter does not support deleting files.`);
                }
             } catch (delError: any) {
                 ctx.log(`Retention Error deletion ${file.name}: ${delError.message}`);
             }
        }

    } catch (error: any) {
        ctx.log(`Retention Process Error: ${error.message}`);
        // We don't throw here to not fail the backup if retention fails
    }
}
