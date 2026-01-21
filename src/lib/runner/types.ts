import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { Job, AdapterConfig, Execution } from "@prisma/client";
import { LogEntry, LogLevel, LogType } from "@/lib/core/logs";

export type JobWithRelations = Job & {
    source: AdapterConfig;
    destination: AdapterConfig;
    notifications: AdapterConfig[];
};

export interface RunnerContext {
    jobId: string;
    job?: JobWithRelations;
    execution?: Execution;

    logs: LogEntry[];
    // Extended log function, simplified version compatible with old signature (msg: string)
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
    updateProgress: (percent: number, stage?: string) => void;

    sourceAdapter?: DatabaseAdapter;
    destAdapter?: StorageAdapter;

    // File paths
    tempFile?: string;
    finalRemotePath?: string;

    // Result Data
    dumpSize?: number;
    metadata?: any;

    status: "Success" | "Failed" | "Running";
    startedAt: Date;
}
