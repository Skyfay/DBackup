import type { ChainPlan } from "@/services/backup/chain-planner";
import { DatabaseAdapter, StorageAdapter, SnapshotHandle } from "@/lib/core/interfaces";
import { Job, AdapterConfig, Execution, JobDestination, JobSource, NotificationTemplate, NotificationTemplateChannel, JobNotificationTemplate } from "@prisma/client";
import { LogEntry, LogLevel, LogType, PipelineStage } from "@/lib/core/logs";
import { RetentionConfiguration } from "@/lib/core/retention";

export type JobDestinationWithConfig = JobDestination & {
    config: AdapterConfig;
};

export type JobSourceWithConfig = JobSource & {
    config: AdapterConfig;
};

export type NotificationTemplateChannelWithConfig = NotificationTemplateChannel & {
    config: AdapterConfig;
};

export type NotificationTemplateWithChannels = NotificationTemplate & {
    channels: NotificationTemplateChannelWithConfig[];
};

export type JobNotificationTemplateWithTemplate = JobNotificationTemplate & {
    template: NotificationTemplateWithChannels;
};

export type JobWithRelations = Job & {
    source: AdapterConfig | null;
    destinations: JobDestinationWithConfig[];
    sources: JobSourceWithConfig[];
    notifications: AdapterConfig[];
    notificationTemplates: JobNotificationTemplateWithTemplate[];
};

export interface DestinationContext {
    configId: string;
    configName: string;
    adapter: StorageAdapter;
    config: Record<string, unknown>; // decrypted adapter config
    retention: RetentionConfiguration;
    retentionPolicyName?: string;
    retentionPolicySource?: 'template' | 'default' | 'legacy' | 'none';
    priority: number;
    adapterId: string;
    uploadResult?: {
        success: boolean;
        path?: string;
        error?: string;
    };
}

/** A resolved directory-backup source (JobSource), ready for the combined dump step to read from. */
export interface DirectorySourceContext {
    jobSourceId: string;
    configId: string;
    configName: string;
    adapter: StorageAdapter;
    config: Record<string, unknown>; // decrypted adapter config
    remotePath: string;
    excludePatterns: string[];
    priority: number;
}

export interface RunnerContext {
    jobId: string;
    job?: JobWithRelations;
    execution?: Execution;

    logs: LogEntry[];
    // Extended log function, simplified version compatible with old signature (msg: string)
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
    updateProgress: (percent: number, stage?: string) => void;

    // New structured stage API
    setStage: (stage: PipelineStage) => void;
    updateDetail: (detail: string) => void;
    updateStageProgress: (internalPercent: number) => void;

    // UNCHANGED meaning - the optional single database source. Its presence/absence is what
    // routes 02-dump.ts between the untouched single-adapter path and the new combined path.
    sourceAdapter?: DatabaseAdapter;
    // NEW, additive - empty array for every job without directory sources (the 99% case today).
    sources: DirectorySourceContext[];
    /**
     * Snapshots created for this run, released in `stepCleanup` - which the runner calls
     * from its `finally`, so they go on success, failure and cancellation alike.
     */
    shadowCopies?: { configId: string; configName: string; adapter: StorageAdapter; config: Record<string, unknown>; handle: SnapshotHandle }[];
    destinations: DestinationContext[];

    // File paths
    tempFile?: string;
    /**
     * Local path of the seekable archive's index sidecar, set only by the combined dump
     * path. Uploaded next to the backup file so browsing and file-level restore never have
     * to download the archive itself.
     */
    indexFile?: string;
    /**
     * Incremental chain decision for this run, set only by the combined dump path.
     * Determines the remote directory and the archive's `full-`/`inc-` prefix, and is
     * recorded on the Execution so retention can reason about chains.
     */
    chain?: ChainPlan;
    finalRemotePath?: string;

    // Result Data
    dumpSize?: number;
    metadata?: any;

    status: "Success" | "Failed" | "Running" | "Partial" | "Cancelled";
    startedAt: Date;

    // Cancellation support
    abortSignal?: AbortSignal;

    // Trigger information
    triggerInfo?: {
        type: string;
        label: string;
    };

    // Auto-lock: if true the backup will be written with locked=true in .meta.json
    lock?: boolean;
}
