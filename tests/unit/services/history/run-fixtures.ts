import type { LogEntry } from "@/lib/core/logs";
import type { RunRecord } from "@/services/history/run-row";

/** A partial backup of Shop offsite: a dump warning, a destination tried three times, a channel that failed. */
export const offsiteLog: LogEntry[] = [
    { timestamp: "2026-09-27T04:00:01.000Z", level: "info", type: "general", message: "Taking job from queue...", stage: "Queued" },
    { timestamp: "2026-09-27T04:00:01.100Z", level: "success", type: "general", message: "Queued completed (0s)", stage: "Queued", durationMs: 100 },
    { timestamp: "2026-09-27T04:00:01.200Z", level: "info", type: "general", message: "Started by the schedule", stage: "Initializing" },
    { timestamp: "2026-09-27T04:00:02.000Z", level: "success", type: "general", message: "Initializing completed (1s)", stage: "Initializing", durationMs: 800 },
    { timestamp: "2026-09-27T04:00:02.100Z", level: "info", type: "command", message: "pg_dump --format=custom --dbname=shop", stage: "Dumping Databases" },
    { timestamp: "2026-09-27T04:01:37.000Z", level: "warning", type: "general", message: "pg_dump: warning: there are circular foreign-key constraints on this table: orders", stage: "Dumping Databases" },
    { timestamp: "2026-09-27T04:03:12.000Z", level: "success", type: "general", message: "Dumping Databases completed (3m 10s)", stage: "Dumping Databases", durationMs: 190_000 },
    { timestamp: "2026-09-27T04:04:15.000Z", level: "info", type: "storage", message: "[NAS Backups] Starting upload...", stage: "Uploading" },
    { timestamp: "2026-09-27T04:05:27.000Z", level: "info", type: "storage", message: "[NAS Backups] Upload complete: Shop offsite/a.tar", stage: "Uploading" },
    { timestamp: "2026-09-27T04:05:31.000Z", level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 5 s", stage: "Uploading" },
    { timestamp: "2026-09-27T04:05:41.000Z", level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 10 s", stage: "Uploading" },
    { timestamp: "2026-09-27T04:05:53.000Z", level: "error", type: "storage", message: "[Google Drive] Upload FAILED: 403 The user's Drive storage quota has been exceeded.", stage: "Uploading" },
    { timestamp: "2026-09-27T04:05:54.000Z", level: "warning", type: "general", message: "Upload summary: 1/2 successful, 1 failed", stage: "Uploading" },
    { timestamp: "2026-09-27T04:07:05.000Z", level: "success", type: "general", message: "Uploading completed (2m 50s)", stage: "Uploading", durationMs: 170_000 },
    { timestamp: "2026-09-27T04:07:14.000Z", level: "info", type: "general", message: "Sending notifications...", stage: "Sending Notifications" },
    { timestamp: "2026-09-27T04:07:14.500Z", level: "info", type: "general", message: "Job completed with partial success", stage: "Completed" },
];

export const destinations = [{ id: "nas", name: "NAS Backups" }, { id: "drive", name: "Google Drive" }];

export function record(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
        id: "run-1",
        jobId: "job-offsite",
        type: "Backup",
        status: "Success",
        startedAt: new Date("2026-09-27T04:00:01.000Z"),
        endedAt: new Date("2026-09-27T04:07:13.000Z"),
        size: BigInt(2_200_000_000),
        path: "Shop offsite/a.tar",
        metadata: JSON.stringify({ names: ["shop", "billing"], destinations: [
            { configId: "nas", name: "NAS Backups", adapterId: "sftp", status: "success" },
            { configId: "drive", name: "Google Drive", adapterId: "google-drive", status: "success" },
        ] }),
        triggerType: "Scheduler",
        triggerLabel: "Scheduler",
        job: { name: "Shop offsite", source: { adapterId: "postgres" }, sources: [] },
        ...overrides,
    };
}
