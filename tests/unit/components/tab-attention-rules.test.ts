import { describe, expect, it } from "vitest";
import { jobsAttention } from "@/components/dashboard/jobs/job-status";
import { backupsAttention, destinationsAttention } from "@/components/dashboard/storage/explorer/destination-model";
import { explorerAttention } from "@/components/dashboard/explorer/database-model";
import { templatesAttention } from "@/components/dashboard/templates/template-attention";

const quiet = { usageSpike: { active: false }, storageLimit: { active: false }, missingBackup: { active: false } };

describe("the dots of the page tabs that work out what needs a look in the browser", () => {
    it("marks the Jobs tab red for a failed last run and amber for one that missed a copy, a live run skipped", () => {
        const jobs = [
            { name: "Nightly MySQL", overview: { runs: [{ status: "Success" }, { status: "Failed" }] } },
            { name: "Files to NAS", overview: { runs: [{ status: "Partial" }, { status: "Running" }] } },
            { name: "CRM daily", overview: { runs: [{ status: "Failed" }, { status: "Success" }] } },
        ];

        expect(jobsAttention(jobs as never)).toEqual({ tone: "destructive", note: "Nightly MySQL failed on its last run. Files to NAS missed a copy on its last run" });
        expect(jobsAttention([jobs[2]] as never)).toBeUndefined();
    });

    it("marks the Backups tab for failed integrity checks and missing copies", () => {
        expect(backupsAttention([{ failedChecks: 2, missingCopies: 0 }, { failedChecks: 0, missingCopies: 1 }] as never))
            .toEqual({ tone: "destructive", note: "2 backups failed their integrity check. 1 copy is missing" });
        expect(backupsAttention([{ failedChecks: 0, missingCopies: 3 }] as never)).toEqual({ tone: "warning", note: "3 copies are missing" });
        expect(backupsAttention([{ failedChecks: 0, missingCopies: 0 }] as never)).toBeUndefined();
    });

    it("marks the Destinations tab for one that does not answer and an alert that is on", () => {
        const destinations = [
            { name: "NAS", health: { status: "OFFLINE" }, alerts: quiet },
            { name: "S3", health: { status: "ONLINE" }, alerts: { ...quiet, missingBackup: { active: true } } },
            { name: "Drive", health: { status: "ONLINE" }, alerts: quiet },
        ];

        expect(destinationsAttention(destinations as never)).toEqual({ tone: "destructive", note: "NAS does not answer. Missing backup at S3 is active" });
        expect(destinationsAttention([destinations[2]] as never)).toBeUndefined();
    });

    it("leaves an air-gapped destination that is not connected out of the dot of the Destinations tab", () => {
        const usb = { name: "USB rotation", airGapped: true, health: { status: "OFFLINE" }, alerts: quiet };

        expect(destinationsAttention([usb] as never)).toBeUndefined();
        expect(destinationsAttention([usb, { ...usb, name: "NAS", airGapped: false }] as never)).toEqual({ tone: "destructive", note: "NAS does not answer" });
    });

    it("marks the Explorer tabs for databases in no job, while the jobs show, and for servers that fail", () => {
        const overview = { servers: [{ name: "db-prod", status: "OFFLINE" }, { name: "db-stage", status: "DEGRADED" }, { name: "db-dev", status: "ONLINE" }] };

        expect(explorerAttention(overview as never, { noJob: 4 } as never, true)).toEqual({
            databases: { tone: "warning", note: "4 databases are in no job" },
            servers: { tone: "destructive", note: "db-prod does not answer. db-stage failed its last check" },
        });
        expect(explorerAttention(overview as never, { noJob: 4 } as never, false).databases).toBeUndefined();
    });

    it("marks the Templates tabs when destinations keep everything and when runs overwrite each other", () => {
        const model = {
            retention: [{ isDefault: false }],
            retentionTotals: { followDefault: 3 },
            naming: [{ pattern: "{job_name}_yyyy-MM-dd", uses: [{ jobId: "hourly" }, { jobId: "nightly" }] }],
            jobs: [
                { id: "hourly", name: "Hourly MySQL", enabled: true, incremental: false, schedule: "0 * * * *" },
                { id: "nightly", name: "Nightly MySQL", enabled: true, incremental: false, schedule: "0 3 * * *" },
            ],
            timezone: "UTC",
        };

        expect(templatesAttention(model as never)).toEqual({
            retention: { tone: "warning", note: "3 destinations have no policy and keep every backup" },
            naming: { tone: "warning", note: "Hourly MySQL overwrites its own backups" },
        });
        expect(templatesAttention({ ...model, retention: [{ isDefault: true }] } as never).retention).toBeUndefined();
    });
});
