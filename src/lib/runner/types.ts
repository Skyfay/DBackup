import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { Job, AdapterConfig, Execution } from "@prisma/client";

export type JobWithRelations = Job & {
    source: AdapterConfig;
    destination: AdapterConfig;
    notifications: AdapterConfig[];
};

export interface RunnerContext {
    jobId: string;
    job?: JobWithRelations;
    execution?: Execution;

    logs: string[];
    log: (msg: string) => void;
    updateProgress: (percent: number, stage?: string) => void;

    sourceAdapter?: DatabaseAdapter;
    destAdapter?: StorageAdapter;

    // File paths
    tempFile?: string;
    finalRemotePath?: string;

    // Result Data
    dumpSize?: number;
    metadata?: any;

    status: "Success" | "Failed";
    startedAt: Date;
}
