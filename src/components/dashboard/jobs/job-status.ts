import { attentionOf, combineAttention, type TabAttention } from "@/lib/core/tab-attention";
import type { JobFilter, JobStats } from "@/services/jobs/job-page-types";

export type { JobFilter };

/** The quick filters of the Jobs page. Which job each holds, the server says, see `job-page-service.ts`. */
export const JOB_FILTERS: { value: JobFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "attention", label: "Needs attention" },
    { value: "running", label: "Running" },
    { value: "paused", label: "Paused" },
];

/** The dot of the Jobs tab, the jobs of Needs attention: red for a failed last run, amber for one that missed a copy. */
export function jobsAttention(stats: Pick<JobStats, "failed" | "partial">): TabAttention | undefined {
    return combineAttention(
        attentionOf("destructive", stats.failed.names, "failed on its last run", "failed on their last run", stats.failed.count),
        attentionOf("warning", stats.partial.names, "missed a copy on its last run", "missed a copy on their last run", stats.partial.count),
    );
}
