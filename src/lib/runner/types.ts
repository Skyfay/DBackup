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
    /**
     * Whether the adapter may stop whatever holds this source open while it is read.
     *
     * Set per job source. Undefined means yes: a consistent backup with a short interruption
     * is what someone asking for one expects, and only an adapter that stops anything at all
     * consults it.
     */
    stopContainers?: boolean;
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

    /** The optional database source. Each of its databases becomes one archive entry. */
    sourceAdapter?: DatabaseAdapter;
    /** Directory sources. An empty array for every job that backs up databases only. */
    sources: DirectorySourceContext[];
    /**
     * Snapshots created for this run, released in `stepCleanup` - which the runner calls
     * from its `finally`, so they go on success, failure and cancellation alike.
     */
    shadowCopies?: {
        configId: string;
        configName: string;
        adapter: StorageAdapter;
        config: Record<string, unknown>;
        handle: SnapshotHandle;
        /**
         * Set once a release has actually succeeded, so `stepCleanup` skips it.
         *
         * The collection releases each group as soon as it is done rather than waiting for
         * the end of the run. A release that failed stays unset on purpose, so cleanup gets
         * a second attempt at it.
         */
        released?: boolean;
    }[];
    destinations: DestinationContext[];

    // File paths
    /**
     * Directory of this run's own files: the archive, its index and its metadata. Made per run,
     * so two runs never share a file, and removed as a whole by the cleanup.
     */
    runDir?: string;
    tempFile?: string;
    /**
     * Local path of the seekable archive's index sidecar, set by the dump step for every
     * backup. Uploaded next to the backup file so browsing and file-level restore never have
     * to download the archive itself.
     */
    indexFile?: string;
    /**
     * Incremental chain decision for this run, set only for jobs with directory sources.
     * Determines the remote directory and the archive's `full-`/`inc-` prefix, and is
     * recorded on the Execution so retention can reason about chains.
     */
    chain?: ChainPlan;
    /**
     * True when the job's naming template placed the chain position in the filename via the
     * {chain} token. The upload step then skips its own prefix, so the position appears once
     * and where the user put it.
     */
    chainInFileName?: boolean;
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
