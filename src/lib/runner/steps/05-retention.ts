import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import { RetentionService } from "@/services/retention-service";
import { RetentionConfiguration } from "@/lib/core/retention";
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
    } catch (_e) {
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
        const backupFiles = files.filter(f => !f.name.endsWith('.meta.json'));

        // Check for Locked files (metadata check)
        if (ctx.destAdapter.read) {
             for (const file of backupFiles) {
                  try {
                      // We assume metadata is alongside
                      const metaContent = await ctx.destAdapter.read(destConfig, file.path + ".meta.json");
                      if (metaContent) {
                          const meta = JSON.parse(metaContent);
                          if (meta.locked) {
                              file.locked = true; // Mark as locked
                          }
                      }
                  } catch (_e) {
                      // Ignore read errors
                  }
             }
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
             } catch (delError: unknown) {
                 const message = delError instanceof Error ? delError.message : String(delError);
                 ctx.log(`Retention Error deletion ${file.name}: ${message}`);
             }
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`Retention Process Error: ${message}`);
        // We don't throw here to not fail the backup if retention fails
    }
}
