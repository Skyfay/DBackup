export type LogLevel = "info" | "success" | "warning" | "error";
export type LogType = "general" | "command" | "storage" | "security";

export interface LogEntry {
  timestamp: string; // ISO String
  level: LogLevel;
  type: LogType;
  message: string;
  stage?: string; // High-level stage grouping - should be a PipelineStage value
  details?: string; // For long output like stdout/stderr
  context?: Record<string, any>; // For metadata
  durationMs?: number;
}

// --- Pipeline Stage System ---

export const PIPELINE_STAGES = {
  QUEUED: "Queued",
  INITIALIZING: "Initializing",
  DUMPING: "Dumping Databases",
  COLLECTING: "Collecting Files",
  PROCESSING: "Processing",
  UPLOADING: "Uploading",
  VERIFYING: "Verifying",
  RETENTION: "Applying Retention",
  NOTIFICATIONS: "Sending Notifications",
  COMPLETED: "Completed",
  FAILED: "Failed",
} as const;

export type PipelineStage = typeof PIPELINE_STAGES[keyof typeof PIPELINE_STAGES];

/** Restore-specific stages */
export const RESTORE_STAGES = {
  INITIALIZING: "Initializing",
  DOWNLOADING: "Downloading",
  DECRYPTING: "Decrypting",
  DECOMPRESSING: "Decompressing",
  RESTORING_DATABASES: "Restoring Databases",
  RESTORING_FILES: "Restoring Files",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
} as const;

export type RestoreStage = typeof RESTORE_STAGES[keyof typeof RESTORE_STAGES];

/** Ordered list of backup stages for frontend rendering */
export const BACKUP_STAGE_ORDER: string[] = [
  PIPELINE_STAGES.QUEUED,
  PIPELINE_STAGES.INITIALIZING,
  PIPELINE_STAGES.DUMPING,
  PIPELINE_STAGES.COLLECTING,
  PIPELINE_STAGES.PROCESSING,
  PIPELINE_STAGES.UPLOADING,
  PIPELINE_STAGES.VERIFYING,
  PIPELINE_STAGES.RETENTION,
  PIPELINE_STAGES.NOTIFICATIONS,
  PIPELINE_STAGES.COMPLETED,
];

/** Ordered list of restore stages for frontend rendering */
export const RESTORE_STAGE_ORDER: string[] = [
  RESTORE_STAGES.INITIALIZING,
  RESTORE_STAGES.DOWNLOADING,
  RESTORE_STAGES.DECRYPTING,
  RESTORE_STAGES.DECOMPRESSING,
  RESTORE_STAGES.RESTORING_DATABASES,
  RESTORE_STAGES.RESTORING_FILES,
  RESTORE_STAGES.COMPLETED,
];

/** Integrity Check stages */
export const INTEGRITY_CHECK_STAGES = {
  INITIALIZING:        "Initializing",
  SCANNING:            "Scanning Storage",
  VERIFYING_CHECKSUMS: "Verifying Checksums",
  COMPLETED:           "Completed",
  FAILED:              "Failed",
} as const;

/** Ordered list of integrity check stages for frontend rendering */
export const INTEGRITY_CHECK_STAGE_ORDER: string[] = [
  "Initializing",
  "Scanning Storage",
  "Verifying Checksums",
  "Completed",
];

export const VERIFICATION_STAGE_ORDER: string[] = [
  "Initializing",
  "Verifying",
  "Completed",
];

/** Progress ranges [min, max] for integrity check stages */
export const INTEGRITY_CHECK_STAGE_PROGRESS_MAP: Record<string, [number, number]> = {
  "Initializing":        [0, 5],
  "Scanning Storage":    [5, 20],
  "Verifying Checksums": [20, 95],
  "Completed":           [100, 100],
  "Failed":              [100, 100],
};

/** @deprecated Use BACKUP_STAGE_ORDER instead */
export const STAGE_ORDER: PipelineStage[] = BACKUP_STAGE_ORDER as PipelineStage[];

/** Progress ranges [min, max] for each stage, forming a continuous 0→100 scale */
export const STAGE_PROGRESS_MAP: Record<PipelineStage, [number, number]> = {
  [PIPELINE_STAGES.QUEUED]:          [0, 0],
  [PIPELINE_STAGES.INITIALIZING]:   [0, 5],
  [PIPELINE_STAGES.DUMPING]:        [5, 25],
  [PIPELINE_STAGES.COLLECTING]:     [25, 45],
  [PIPELINE_STAGES.PROCESSING]:     [45, 65],
  [PIPELINE_STAGES.UPLOADING]:      [65, 88],
  [PIPELINE_STAGES.VERIFYING]:      [88, 92],
  [PIPELINE_STAGES.RETENTION]:      [92, 97],
  [PIPELINE_STAGES.NOTIFICATIONS]:  [97, 100],
  [PIPELINE_STAGES.COMPLETED]:      [100, 100],
  [PIPELINE_STAGES.FAILED]:         [100, 100],
};

/**
 * Calculate global progress (0–100) from a stage and its internal progress (0–100).
 * Example: stageProgress("Uploading", 50) → 76  (midpoint of 65..88)
 */
export function stageProgress(stage: PipelineStage, internalPercent: number): number {
  const range = STAGE_PROGRESS_MAP[stage];
  if (!range) return 0;
  const [min, max] = range;
  const clamped = Math.max(0, Math.min(100, internalPercent));
  return Math.round(min + (max - min) * (clamped / 100));
}
