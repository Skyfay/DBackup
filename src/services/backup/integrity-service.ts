import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { verificationService } from "@/services/storage/verification-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { INTEGRITY_CHECK_STAGES } from "@/lib/core/logs";
import { isBackupFile } from "@/lib/core/backup-files";

const log = logger.child({ service: "IntegrityService" });

registerAdapters();

export interface IntegrityCheckResult {
  totalFiles: number;
  verified: number;
  passed: number;
  failed: number;
  skipped: number;
  scanFailed: number;
  errors: Array<{
    file: string;
    destination: string;
    expected: string;
    actual: string;
  }>;
}

export interface IntegrityProgressCallbacks {
  onLog: (message: string, level?: "info" | "success" | "warning" | "error", details?: string) => void;
  onStage: (stage: string) => void;
  onFileProgress: (done: number, total: number, currentFile?: string) => void;
}

interface IntegrityFilters {
  skipPassed: boolean;
  maxAgeDays: number;
  maxFileSizeBytes: number;
}

interface WorkItem {
  storageConfigId: string;
  destinationName: string;
  remotePath: string;
  fileName: string;
}

export class IntegrityService {
  async runFullIntegrityCheck(callbacks?: IntegrityProgressCallbacks): Promise<IntegrityCheckResult> {
    log.info("Starting full backup integrity check");

    const result: IntegrityCheckResult = {
      totalFiles: 0,
      verified: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      scanFailed: 0,
      errors: [],
    };

    const [skipPassedSetting, maxAgeSetting, maxSizeSetting, scanModeSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'integrity.skipPassed' } }),
      prisma.systemSetting.findUnique({ where: { key: 'integrity.maxAgeDays' } }),
      prisma.systemSetting.findUnique({ where: { key: 'integrity.maxFileSizeMb' } }),
      prisma.systemSetting.findUnique({ where: { key: 'integrity.scanMode' } }),
    ]);

    const filters: IntegrityFilters = {
      skipPassed: skipPassedSetting?.value === 'true',
      maxAgeDays: parseInt(maxAgeSetting?.value ?? '0') || 0,
      maxFileSizeBytes: (parseInt(maxSizeSetting?.value ?? '0') || 0) * 1024 * 1024,
    };

    const isJobsMode = !scanModeSetting || scanModeSetting.value !== 'destinations';

    log.info("Integrity check config", {
      mode: isJobsMode ? 'jobs' : 'destinations',
      skipPassed: filters.skipPassed,
      maxAgeDays: filters.maxAgeDays,
      maxFileSizeMb: filters.maxFileSizeBytes / 1024 / 1024,
    });

    callbacks?.onStage(INTEGRITY_CHECK_STAGES.INITIALIZING);

    const filterParts: string[] = [];
    if (filters.maxAgeDays > 0) filterParts.push(`max age ${filters.maxAgeDays} days`);
    if (filters.maxFileSizeBytes > 0) filterParts.push(`max size ${filters.maxFileSizeBytes / 1024 / 1024} MB`);
    if (filters.skipPassed) filterParts.push("skip already-passed files");
    callbacks?.onLog(
      filterParts.length > 0 ? `Filters: ${filterParts.join(", ")}` : "No filters configured - checking all files"
    );

    callbacks?.onLog(`Scan mode: ${isJobsMode ? 'Jobs (job-linked files only)' : 'All destinations (full storage scan)'}`);

    // Pass 1: Collect work items according to scan mode
    callbacks?.onStage(INTEGRITY_CHECK_STAGES.SCANNING);

    const allWorkItems: WorkItem[] = [];

    if (isJobsMode) {
      try {
        const { items, scanFailed } = await this.gatherFilesFromJobs(filters, callbacks);
        allWorkItems.push(...items);
        result.scanFailed += scanFailed;
      } catch (e: unknown) {
        log.error("Failed to gather files from jobs", {}, wrapError(e));
        callbacks?.onLog("Failed to scan job-linked files", "error");
        result.scanFailed++;
      }
    } else {
      const storageConfigs = await prisma.adapterConfig.findMany({
        where: { type: "storage" },
      });

      callbacks?.onLog(`Found ${storageConfigs.length} storage destination${storageConfigs.length !== 1 ? "s" : ""}`);

      for (const storageConfig of storageConfigs) {
        try {
          const items = await this.gatherFilesFromDestination(storageConfig, filters, callbacks);
          allWorkItems.push(...items);
        } catch (e: unknown) {
          log.error("Failed to scan storage destination", { destination: storageConfig.name }, wrapError(e));
          callbacks?.onLog(`Failed to scan ${storageConfig.name}`, "error");
          result.scanFailed++;
        }
      }
    }

    result.totalFiles = allWorkItems.length;
    callbacks?.onLog(
      `Total: ${allWorkItems.length} file${allWorkItems.length !== 1 ? "s" : ""} to verify`,
      "info"
    );

    if (allWorkItems.length === 0) {
      callbacks?.onLog("No files to verify - check filters or storage contents", "info");
      return result;
    }

    // Pass 2: Verify all collected files
    callbacks?.onStage(INTEGRITY_CHECK_STAGES.VERIFYING_CHECKSUMS);

    for (let i = 0; i < allWorkItems.length; i++) {
      const item = allWorkItems[i];
      callbacks?.onFileProgress(i, allWorkItems.length, item.fileName);

      try {
        const verifyResult = await verificationService.verifyFile(
          item.storageConfigId,
          item.remotePath,
          "scheduled",
          { skipIfPassed: filters.skipPassed }
        );

        if (verifyResult.status === "passed") {
          result.verified++;
          result.passed++;
          callbacks?.onLog(`${item.fileName}`, "success");
        } else if (verifyResult.status === "failed") {
          result.verified++;
          result.failed++;
          result.errors.push({
            file: item.fileName,
            destination: item.destinationName,
            expected: verifyResult.expectedChecksum ?? "",
            actual: verifyResult.actualChecksum ?? "",
          });
          callbacks?.onLog(
            `${item.fileName} - checksum mismatch`,
            "error",
            `Expected: ${verifyResult.expectedChecksum ?? "unknown"}\nActual:   ${verifyResult.actualChecksum ?? "unknown"}`
          );
        } else {
          result.skipped++;
          const skipReasons: Record<string, string> = {
            skipped: "already verified",
            no_metadata: "no metadata file",
            no_checksum: "no checksum stored",
            download_error: "download failed",
          };
          const reason = skipReasons[verifyResult.status] ?? verifyResult.status;
          callbacks?.onLog(`${item.fileName} skipped (${reason})`, "info");
        }
      } catch (e: unknown) {
        log.error("Failed to verify file", { file: item.fileName, destination: item.destinationName }, wrapError(e));
        callbacks?.onLog(`Failed to verify ${item.fileName}`, "error");
        result.skipped++;
      }

      callbacks?.onFileProgress(i + 1, allWorkItems.length, item.fileName);
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

  private async gatherFilesFromJobs(
    filters: IntegrityFilters,
    callbacks?: IntegrityProgressCallbacks
  ): Promise<{ items: WorkItem[]; scanFailed: number }> {
    const jobs = await prisma.job.findMany({
      where: { enabled: true },
      include: {
        destinations: {
          include: { config: true },
        },
      },
    });

    callbacks?.onLog(`Found ${jobs.length} job${jobs.length !== 1 ? "s" : ""} to scan`);

    const eligibleJobs = jobs.filter((j) => !j.skipVerification);
    const skippedJobs = jobs.filter((j) => j.skipVerification);

    for (const job of skippedJobs) {
      callbacks?.onLog(`${job.name}: verification disabled - skipping`, "info");
    }

    const seen = new Set<string>();
    const workItems: WorkItem[] = [];
    let scanFailed = 0;

    // Track per-job file counts for logging
    const jobCounts = new Map<string, number>();
    for (const job of eligibleJobs) jobCounts.set(job.name, 0);

    // Collect all unique destinations across eligible jobs, then list each once
    const destJobMap = new Map<string, { dest: typeof jobs[0]["destinations"][0]; jobNames: string[] }>();
    for (const job of eligibleJobs) {
      for (const dest of job.destinations) {
        const destMeta = dest.config.metadata ? JSON.parse(dest.config.metadata) : {};
        if (destMeta.skipVerification === true) continue;
        const existing = destJobMap.get(dest.configId);
        if (existing) {
          existing.jobNames.push(job.name);
        } else {
          destJobMap.set(dest.configId, { dest, jobNames: [job.name] });
        }
      }
    }

    for (const { dest, jobNames } of destJobMap.values()) {
      const adapter = registry.get(dest.config.adapterId) as StorageAdapter;
      if (!adapter) {
        callbacks?.onLog(`${dest.config.name}: adapter '${dest.config.adapterId}' not found`, "error");
        scanFailed++;
        continue;
      }

      let config: Awaited<ReturnType<typeof resolveAdapterConfig>>;
      try {
        config = await resolveAdapterConfig(dest.config);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        callbacks?.onLog(`${dest.config.name}: config resolution failed - ${msg}`, "error");
        scanFailed++;
        continue;
      }

      let allFiles: Awaited<ReturnType<StorageAdapter["list"]>> = [];
      try {
        allFiles = await adapter.list(config, "");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn("Could not list destination", { destination: dest.config.name }, wrapError(e));
        callbacks?.onLog(`${dest.config.name}: listing failed - ${msg}`, "error");
        scanFailed++;
        continue;
      }

      // Keep only files that belong to one of the eligible jobs (path starts with jobName/)
      const backupFiles = allFiles.filter(
        (f) => isBackupFile(f.name) && jobNames.some((n) => f.path.startsWith(n + "/"))
      );

      for (const file of backupFiles) {
        if (filters.maxAgeDays > 0 && file.lastModified) {
          const ageDays = (Date.now() - new Date(file.lastModified).getTime()) / 86_400_000;
          if (ageDays > filters.maxAgeDays) continue;
        }

        if (filters.maxFileSizeBytes > 0 && file.size > filters.maxFileSizeBytes) continue;

        const key = `${dest.configId}:${file.path}`;
        if (seen.has(key)) continue;
        seen.add(key);

        workItems.push({
          storageConfigId: dest.configId,
          destinationName: dest.config.name,
          remotePath: file.path,
          fileName: file.name,
        });

        const matchingJob = jobNames.find((n) => file.path.startsWith(n + "/"));
        if (matchingJob) jobCounts.set(matchingJob, (jobCounts.get(matchingJob) ?? 0) + 1);
      }
    }

    for (const [jobName, count] of jobCounts.entries()) {
      callbacks?.onLog(`${jobName}: found ${count} file${count !== 1 ? "s" : ""} to verify`);
    }

    return { items: workItems, scanFailed };
  }

  private async gatherFilesFromDestination(
    storageConfig: any,
    filters: IntegrityFilters,
    callbacks?: IntegrityProgressCallbacks
  ): Promise<WorkItem[]> {
    // Check if this destination has verification disabled
    const meta = storageConfig.metadata ? JSON.parse(storageConfig.metadata) : {};
    if (meta.skipVerification === true) {
      callbacks?.onLog(`${storageConfig.name}: verification disabled - skipping`, "info");
      return [];
    }

    const workItems: WorkItem[] = [];
    const adapter = registry.get(storageConfig.adapterId) as StorageAdapter;
    if (!adapter) {
      log.warn("Storage adapter not found", { adapterId: storageConfig.adapterId });
      return [];
    }

    const config = await resolveAdapterConfig(storageConfig);

    // Collect all files from storage. Adapters return flat recursive listings where
    // file.name is the basename and file.path is the full relative path — use file.path
    // as remotePath so downstream download/read calls resolve the correct location.
    let allFiles: Awaited<ReturnType<StorageAdapter["list"]>> = [];
    try {
      allFiles = await adapter.list(config, "");
    } catch (e: unknown) {
      log.warn(
        "Could not list storage root, falling back to active jobs",
        { destination: storageConfig.name },
        wrapError(e)
      );
      const jobs = await prisma.job.findMany({
        where: { destinations: { some: { configId: storageConfig.id } } },
        select: { name: true },
      });
      for (const job of jobs) {
        try {
          const files = await adapter.list(config, job.name);
          allFiles.push(...files);
        } catch {
          // skip unreachable job folders
        }
      }
    }

    const backupFiles = allFiles.filter((f) => isBackupFile(f.name));

    for (const file of backupFiles) {
      if (filters.maxAgeDays > 0 && file.lastModified) {
        const ageDays = (Date.now() - new Date(file.lastModified).getTime()) / 86_400_000;
        if (ageDays > filters.maxAgeDays) continue;
      }

      if (filters.maxFileSizeBytes > 0 && file.size > filters.maxFileSizeBytes) continue;

      workItems.push({
        storageConfigId: storageConfig.id,
        destinationName: storageConfig.name,
        remotePath: file.path,
        fileName: file.name,
      });
    }

    callbacks?.onLog(
      `${storageConfig.name}: found ${workItems.length} file${workItems.length !== 1 ? "s" : ""} to verify`
    );

    return workItems;
  }
}

export const integrityService = new IntegrityService();
