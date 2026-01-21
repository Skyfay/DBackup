import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import { RetentionService } from "@/services/retention-service";
import { RetentionConfiguration, DEFAULT_RETENTION_CONFIG } from "@/lib/core/retention";
import { FileInfo } from '@/lib/core/interfaces';
import path from "path";

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
        if (!ctx.destAdapter.list) {
             ctx.log("Retention warning: Storage adapter does not support listing files. Retention skipped.");
             return;
        }

        // Fix: config is stored as a JSON string in DB, need to parse it first
        const destConfig = decryptConfig(JSON.parse(ctx.job.destination.config));

        // Determine remote directory
        // Ideally, we use the path where we just uploaded the file.
        // This ensures we always clean up the correct directory, regardless of storage backend structure.
        let remoteDir = `/backups/${ctx.job.name}`; // Default fallback

        if (ctx.finalRemotePath) {
            // If upload was successful, use the parent directory of the uploaded file
            // path.dirname works for both local paths and storage keys (usually / or \ separated)
            // We ensure forward slashes found in typical storage keys
            remoteDir = path.dirname(ctx.finalRemotePath).replace(/\\/g, '/');
        } else {
             ctx.log(`Retention: Warning - finalRemotePath not set (Upload skipped?), using fallback: ${remoteDir}`);
        }

        const files: FileInfo[] = await ctx.destAdapter.list(destConfig, remoteDir);

        // Filter out metadata files for the policy calculation
        // We only want to count "real" backups (artifacts)
        let backupFiles = files.filter(f => !f.name.endsWith('.meta.json'));

        // Check for Locked files (metadata check)
        // Since we don't want to delete locked files, AND they usually shouldn't count towards the policy (as per user request "nicht erfasst"),
        // we need to identify them.
        // Performance Warning: This reads metadata for ALL files in the retention scope.
        if (ctx.destAdapter.read) {
             const unlockedBackups: FileInfo[] = [];

             for (const file of backupFiles) {
                  try {
                      // We assume metadata is alongside
                      const metaContent = await ctx.destAdapter.read(destConfig, file.path + ".meta.json");
                      if (metaContent) {
                          const meta = JSON.parse(metaContent);
                          if (meta.locked) {
                              ctx.log(`Retention: Ignoring locked file ${file.name}`);
                              continue;
                          }
                      }
                  } catch (e) {
                      // If metadata read fails, assume not locked? Or fail safe?
                      // We assume not locked to proceed with standard logic, but log it?
                      // Or maybe we treat "missing metadata" as "old file" -> delete?
                  }
                  unlockedBackups.push(file);
             }
             backupFiles = unlockedBackups;
        }

        // Apply Policy
        const { keep, delete: filesToDelete } = RetentionService.calculateRetention(backupFiles, policy);

        ctx.log(`Retention: Keeping ${keep.length}, Deleting ${filesToDelete.length}.`);

        // 4. Delete files
        for (const file of filesToDelete) {
             ctx.log(`Retention: Deleting old backup ${file.name}...`);
             try {
                if (ctx.destAdapter.delete) {
                    // Delete the main backup file
                    await ctx.destAdapter.delete(destConfig, file.path);

                    // Explicitly delete the corresponding metadata file
                    // The metadata file is always named: originalFilename + ".meta.json"
                    const metaPath = file.path + ".meta.json";
                    await ctx.destAdapter.delete(destConfig, metaPath).catch(() => {
                        // Ignore error if metadata doesn't exist
                    });
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
