import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { getTempDir } from "@/lib/temp-dir";
import { verifyFileChecksum } from "@/lib/checksum";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const log = logger.child({ service: "IntegrityService" });

// Ensure adapters are loaded
registerAdapters();

export interface IntegrityCheckResult {
  totalFiles: number;
  verified: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: Array<{
    file: string;
    destination: string;
    expected: string;
    actual: string;
  }>;
}

/**
 * Service for verifying the integrity of backup files on storage.
 * Iterates over all storage destinations, downloads each backup file,
 * computes its SHA-256 checksum, and compares it against the stored metadata.
 */
export class IntegrityService {
  /**
   * Runs an integrity check on all backup files across all storage destinations.
   * Only checks files that have a checksum in their metadata sidecar.
   */
  async runFullIntegrityCheck(): Promise<IntegrityCheckResult> {
    log.info("Starting full backup integrity check");

    const result: IntegrityCheckResult = {
      totalFiles: 0,
      verified: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    // Get all storage adapters
    const storageConfigs = await prisma.adapterConfig.findMany({
      where: { type: "storage" },
    });

    for (const storageConfig of storageConfigs) {
      try {
        await this.checkDestination(storageConfig, result);
      } catch (e: unknown) {
        log.error(
          "Failed to check storage destination",
          { destination: storageConfig.name },
          wrapError(e)
        );
      }
    }

    log.info("Integrity check completed", {
      totalFiles: result.totalFiles,
      verified: result.verified,
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
    });

    return result;
  }

  private async checkDestination(
    storageConfig: any,
    result: IntegrityCheckResult
  ) {
    const adapter = registry.get(storageConfig.adapterId) as StorageAdapter;
    if (!adapter) {
      log.warn("Storage adapter not found", {
        adapterId: storageConfig.adapterId,
      });
      return;
    }

    const config = decryptConfig(JSON.parse(storageConfig.config));

    // List all top-level folders in storage (not just active jobs).
    // This ensures backups from deleted jobs are also verified.
    let folders: string[] = [];
    try {
      const topLevel = await adapter.list(config, "");
      folders = topLevel
        .filter((f) => f.name && !f.name.endsWith(".meta.json"))
        .map((f) => f.name);
    } catch (e: unknown) {
      log.warn(
        "Could not list storage root, falling back to active jobs",
        { destination: storageConfig.name },
        wrapError(e)
      );
      // Fallback: use known job names
      const jobs = await prisma.job.findMany({
        where: { destinationId: storageConfig.id },
        select: { name: true },
      });
      folders = jobs.map((j) => j.name);
    }

    for (const folder of folders) {
      try {
        // List files in folder
        const files = await adapter.list(config, folder);

        // Filter to only backup files (exclude .meta.json)
        const backupFiles = files.filter(
          (f) => !f.name.endsWith(".meta.json")
        );

        for (const file of backupFiles) {
          result.totalFiles++;

          try {
            await this.verifyFile(
              adapter,
              config,
              `${folder}/${file.name}`,
              storageConfig.name,
              result
            );
          } catch (e: unknown) {
            log.error(
              "Failed to verify file",
              { file: file.name, destination: storageConfig.name },
              wrapError(e)
            );
            result.skipped++;
          }
        }
      } catch (e: unknown) {
        log.warn(
          "Failed to list files for folder",
          { folder, destination: storageConfig.name },
          wrapError(e)
        );
      }
    }
  }

  private async verifyFile(
    adapter: StorageAdapter,
    config: any,
    remotePath: string,
    destinationName: string,
    result: IntegrityCheckResult
  ) {
    const fileName = path.basename(remotePath);

    // 1. Try to read metadata sidecar
    let metadata: BackupMetadata | null = null;

    if (adapter.read) {
      try {
        const metaContent = await adapter.read(
          config,
          remotePath + ".meta.json"
        );
        if (metaContent) {
          metadata = JSON.parse(metaContent);
        }
      } catch {
        // No metadata file, skip
      }
    }

    if (!metadata) {
      // Try download-based approach
      const tempMetaPath = path.join(
        getTempDir(),
        `integrity_meta_${crypto.randomUUID()}.json`
      );
      try {
        const ok = await adapter.download(
          config,
          remotePath + ".meta.json",
          tempMetaPath
        );
        if (ok) {
          const content = await fs.promises.readFile(tempMetaPath, "utf-8");
          metadata = JSON.parse(content);
        }
      } catch {
        // No metadata
      } finally {
        await fs.promises.unlink(tempMetaPath).catch(() => {});
      }
    }

    if (!metadata?.checksum) {
      log.debug("No checksum in metadata, skipping", { file: fileName });
      result.skipped++;
      return;
    }

    // 2. Download the backup file to temp
    const tempFilePath = path.join(
      getTempDir(),
      `integrity_${crypto.randomUUID()}_${fileName}`
    );

    try {
      const downloadOk = await adapter.download(
        config,
        remotePath,
        tempFilePath
      );
      if (!downloadOk) {
        log.warn("Could not download file for verification", {
          file: fileName,
        });
        result.skipped++;
        return;
      }

      // 3. Verify checksum
      const verification = await verifyFileChecksum(
        tempFilePath,
        metadata.checksum
      );
      result.verified++;

      if (verification.valid) {
        log.debug("File integrity OK", { file: fileName });
        result.passed++;
      } else {
        log.error("INTEGRITY FAILURE", {
          file: fileName,
          destination: destinationName,
          expected: verification.expected,
          actual: verification.actual,
        });
        result.failed++;
        result.errors.push({
          file: fileName,
          destination: destinationName,
          expected: verification.expected,
          actual: verification.actual,
        });
      }
    } finally {
      // Always cleanup temp file
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  }
}

export const integrityService = new IntegrityService();
