import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { Job, AdapterConfig, Execution, JobDestination } from "@prisma/client";
import { LogEntry, LogLevel, LogType, PipelineStage } from "@/lib/core/logs";
import { RetentionConfiguration } from "@/lib/core/retention";

export type JobDestinationWithConfig = JobDestination & {
    config: AdapterConfig;
};

export type JobWithRelations = Job & {
    source: AdapterConfig;
    destinations: JobDestinationWithConfig[];
    notifications: AdapterConfig[];
};

export interface DestinationContext {
    configId: string;
    configName: string;
    adapter: StorageAdapter;
    config: Record<string, unknown>; // decrypted adapter config
    retention: RetentionConfiguration;
    priority: number;
    adapterId: string;
    uploadResult?: {
        success: boolean;
        path?: string;
        error?: string;
    };
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

    sourceAdapter?: DatabaseAdapter;
    destinations: DestinationContext[];

    // File paths
    tempFile?: string;
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
