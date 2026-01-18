import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { Job, Source, Destination, Execution, Notification } from "@prisma/client";

export type JobWithRelations = Job & {
    source: Source;
    destination: Destination;
    notifications: Source[]; // Assuming notifications are linked to Source entities (which act as channels)
};

export interface RunnerContext {
    jobId: string;
    job?: JobWithRelations;
    execution?: Execution;

    logs: string[];
    log: (msg: string) => void;

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
