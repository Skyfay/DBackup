"use client";

import { QuickFilter } from "@/components/ui/quick-filter";
import { JOB_FILTERS, type JobFilter } from "./job-status";

/** Failed and partial runs are red like the issues of a connection, a run in progress is the running blue. */
const DOTS: Partial<Record<JobFilter, string>> = { attention: "bg-destructive", running: "bg-info" };

interface JobStatusFilterProps {
    value: JobFilter;
    onChange: (value: JobFilter) => void;
    /** How many jobs each filter holds, from the server. None while the first page loads. */
    counts: Record<JobFilter, number> | null;
}

/** The quick filters of the Jobs page with how many jobs each holds, beside the search like on the Connections page. */
export function JobStatusFilter({ value, onChange, counts }: JobStatusFilterProps) {
    return (
        <QuickFilter
            aria-label="Filter by status"
            value={value}
            onChange={onChange}
            options={JOB_FILTERS.map((filter) => ({
                ...filter,
                dot: DOTS[filter.value],
                count: counts?.[filter.value],
            }))}
        />
    );
}
