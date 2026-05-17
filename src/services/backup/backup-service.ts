import { runJob, TriggerInfo, RunJobOptions } from "@/lib/runner";

export class BackupService {
    /**
     * Triggers a backup execution for a specific job.
     * Currently wraps the runner logic, but serves as the standard entry point.
     */
    async executeJob(jobId: string, triggerInfo?: TriggerInfo, options?: RunJobOptions) {
        return runJob(jobId, triggerInfo, options);
    }
}

export const backupService = new BackupService();
