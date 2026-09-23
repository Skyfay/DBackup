import type { JobListItem } from "@/services/jobs/job-list-service";

/** The quick filters of the Jobs page. */
export type JobFilter = "all" | "attention" | "running" | "paused";

export const JOB_FILTERS: { value: JobFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "attention", label: "Needs attention" },
    { value: "running", label: "Running" },
    { value: "paused", label: "Paused" },
];

const FINISHED = new Set(["Success", "Failed", "Partial", "Cancelled"]);

/** The status of the newest finished run, a live one skipped. */
export function lastOutcome(job: JobListItem): string | null {
    for (let index = job.overview.runs.length - 1; index >= 0; index--) {
        const run = job.overview.runs[index];
        if (FINISHED.has(run.status)) return run.status;
    }
    return null;
}

/** Whether a job belongs to a quick filter. A job needs attention while its last finished run failed or was partial. */
export function matchesJobFilter(job: JobListItem, filter: JobFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "attention": {
            const outcome = lastOutcome(job);
            return outcome === "Failed" || outcome === "Partial";
        }
        case "running":
            return job.overview.live !== null;
        case "paused":
            return !job.enabled;
    }
}
