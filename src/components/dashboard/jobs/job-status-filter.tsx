"use client";

import { QuickFilter } from "@/components/ui/quick-filter";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { JOB_FILTERS, matchesJobFilter, type JobFilter } from "./job-status";

/** Failed and partial runs are red like the issues of a connection, a run in progress is the running blue. */
const DOTS: Partial<Record<JobFilter, string>> = { attention: "bg-destructive", running: "bg-info" };

interface JobStatusFilterProps {
    value: JobFilter;
    onChange: (value: JobFilter) => void;
    jobs: JobListItem[];
}

/** The quick filters of the Jobs page with how many jobs each holds, beside the search like on the Connections page. */
export function JobStatusFilter({ value, onChange, jobs }: JobStatusFilterProps) {
    return (
        <QuickFilter
            aria-label="Filter by status"
            value={value}
            onChange={onChange}
            options={JOB_FILTERS.map((filter) => ({
                ...filter,
                dot: DOTS[filter.value],
                count: jobs.filter((job) => matchesJobFilter(job, filter.value)).length,
            }))}
        />
    );
}
