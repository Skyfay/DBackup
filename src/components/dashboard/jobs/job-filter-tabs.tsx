"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { JOB_FILTERS, matchesJobFilter, type JobFilter } from "./job-status";

interface JobFilterTabsProps {
    value: JobFilter;
    onChange: (value: JobFilter) => void;
    jobs: JobListItem[];
}

function Label({ label, count }: { label: string; count: number }) {
    return (
        <span className="flex items-center gap-2">
            {label}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
        </span>
    );
}

/**
 * The quick filters with how many jobs each holds, where the Connections page has its tabs.
 * A phone picks from a menu, the tabs do not fit beside the New button there. Both are
 * hidden by CSS rather than by the measured screen, so neither pops in after loading.
 */
export function JobFilterTabs({ value, onChange, jobs }: JobFilterTabsProps) {
    const counts = new Map(JOB_FILTERS.map((filter) => [filter.value, jobs.filter((job) => matchesJobFilter(job, filter.value)).length]));
    return (
        <>
            <div className="min-w-0 flex-1 md:hidden">
                <Select value={value} onValueChange={(next) => onChange(next as JobFilter)}>
                    <SelectTrigger className="w-full" aria-label="Show jobs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {JOB_FILTERS.map((filter) => (
                            <SelectItem key={filter.value} value={filter.value}>
                                <Label label={filter.label} count={counts.get(filter.value) ?? 0} />
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <Tabs value={value} onValueChange={(next) => onChange(next as JobFilter)} className="hidden min-w-0 md:flex">
                <TabsList aria-label="Show jobs">
                    {JOB_FILTERS.map((filter) => (
                        <TabsTrigger key={filter.value} value={filter.value}>
                            <Label label={filter.label} count={counts.get(filter.value) ?? 0} />
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
        </>
    );
}
